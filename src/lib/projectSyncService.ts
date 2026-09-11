/**
 * Generic project op-sync core (task #50; design `docs/notes/764-unified-project-sync-architecture.md`).
 *
 * Generalizes the source-library versioned change-log (`lanHostService.ts`) into a workspace-AGNOSTIC
 * primitive: every workspace — Paper, Image, Flow, Video — and the source library ride **one monotonic
 * version stream** of channel-tagged ops over the same LAN long-poll relay, so "they all get it at the
 * same time" (the user's framing). The phone is the authority; served clients (browser OR the desktop
 * app in compute-client mode) tail a single cursor and dispatch each event by channel.
 *
 * This module owns two things:
 *   1. The host-authority **event log** — one monotonic `version` across all channels, each event
 *      tagged with its `channel`. Served clients long-poll it with a single global cursor and filter
 *      to whatever channels they care about.
 *   2. The **channel registry** — each workspace registers an `applyRemote` / `snapshot` / `restore`
 *      so the generic seed + subscriber loop can drive every workspace identically.
 *
 * Pure + platform-agnostic: it is fed on the phone (authority) and read by the phone's relay handler,
 * and no-ops everywhere else. NO websocket/SSE — long-poll only (see lan-host-security-and-sync).
 */

/** A workspace/channel identifier, e.g. `'source-library'`, `'flow'`, `'paper'`, `'image'`, `'project'`. */
export type ProjectSyncChannelId = string;

/** One op on the wire. The log is a single monotonic `version` stream; `channel` tags who owns `change`. */
export interface ProjectSyncEvent<TChange = unknown> {
  version: number;
  channel: ProjectSyncChannelId;
  change: TChange;
}

export interface ProjectSyncEventsResult {
  version: number;
  events: ProjectSyncEvent[];
  /** The caller's cursor predates the bounded retained tail and must repair from a snapshot. */
  gap: boolean;
}

/**
 * The uniform contract every workspace registers — identical across Paper / Image / Flow / Video /
 * source-library. The generic seed + subscriber drives all channels through exactly this shape.
 */
export interface ProjectSyncChannel<TChange = unknown> {
  id: ProjectSyncChannelId;
  /**
   * Apply a remote op to local state WITHOUT re-broadcasting it (the echo-loop rule — apply via a
   * non-broadcasting setter). Returns whether local state actually changed.
   */
  applyRemote(change: TChange): boolean | Promise<boolean>;
  /** Full snapshot op for seed + version-gap repair (pull). Heavy bytes excluded; streamed on demand. */
  snapshot(): TChange | Promise<TChange>;
  /** (host) Restore from a client-pushed snapshot during repair (push). */
  restore?(snapshot: TChange): void | Promise<void>;
}

// ---------------------------------------------------------------------------------------------------
// Host-authority event log (one monotonic version across all channels)
// ---------------------------------------------------------------------------------------------------

/** Keep a bounded tail of recent events so a briefly-disconnected client can catch up by version. */
const MAX_LOG_ENTRIES = 512;

let hostVersion = 0;
const eventLog: ProjectSyncEvent[] = [];
type WaiterNotify = () => void;
const waiters = new Set<WaiterNotify>();

/** Current authority version — handed to a client when it seeds, then used as its long-poll cursor. */
export function getProjectSyncVersion(): number {
  return hostVersion;
}

/**
 * Record a channel-tagged change as the next authority version and wake parked long-poll waiters.
 * Each woken waiter re-evaluates its own cursor + channel filter and either settles or stays parked,
 * so an op on channel A never spuriously settles a waiter that only cares about channel B.
 */
export function recordProjectSyncChange<TChange>(
  channel: ProjectSyncChannelId,
  change: TChange,
): ProjectSyncEvent<TChange> {
  hostVersion += 1;
  const event: ProjectSyncEvent<TChange> = { version: hostVersion, channel, change };
  eventLog.push(event);
  if (eventLog.length > MAX_LOG_ENTRIES) {
    eventLog.splice(0, eventLog.length - MAX_LOG_ENTRIES);
  }

  if (waiters.size > 0) {
    for (const notify of [...waiters]) notify();
  }

  return event;
}

/**
 * Events strictly newer than `since` (a client's last-applied **global** version), optionally
 * filtered to a single channel. The cursor is global even when filtered, so a client never misses a
 * matching op even though other channels' versions interleave.
 */
export function getProjectSyncEventsSince(
  since: number,
  channelFilter?: ProjectSyncChannelId,
): ProjectSyncEvent[] {
  const base = Number.isFinite(since) ? eventLog.filter((event) => event.version > since) : [...eventLog];
  return channelFilter ? base.filter((event) => event.channel === channelFilter) : base;
}

/**
 * Long-poll: resolve immediately with any matching events newer than `since`, otherwise park until a
 * matching change is recorded or `timeoutMs` (a heartbeat that returns an empty batch so the client
 * re-polls). `result.version` is always the current global authority version (the client's next cursor).
 */
export function waitForProjectSyncEvents(
  since: number,
  timeoutMs: number,
  channelFilter?: ProjectSyncChannelId,
): Promise<ProjectSyncEventsResult> {
  const gap = projectSyncCursorHasGap(since);
  const immediate = getProjectSyncEventsSince(since, channelFilter);
  if (gap || immediate.length > 0) {
    return Promise.resolve({ version: hostVersion, events: immediate, gap });
  }

  return new Promise<ProjectSyncEventsResult>((resolve) => {
    let settled = false;
    const settle = (result: ProjectSyncEventsResult) => {
      if (settled) return;
      settled = true;
      waiters.delete(notify);
      clearTimeout(timer);
      resolve(result);
    };
    const notify: WaiterNotify = () => {
      const events = getProjectSyncEventsSince(since, channelFilter);
      const wakeGap = projectSyncCursorHasGap(since);
      if (wakeGap || events.length > 0) settle({ version: hostVersion, events, gap: wakeGap });
      // else: no matching events yet — stay parked until another change or the heartbeat timeout.
    };
    const timer = setTimeout(() => settle({
      version: hostVersion,
      events: getProjectSyncEventsSince(since, channelFilter),
      gap: projectSyncCursorHasGap(since),
    }), timeoutMs);
    waiters.add(notify);
  });
}

/** True when at least one global event between the cursor and retained tail has been evicted. */
export function projectSyncCursorHasGap(since: number): boolean {
  const oldestRetainedVersion = eventLog[0]?.version;
  if (!Number.isFinite(since)) return false;
  // Authority process/app restart: its monotonic epoch reset underneath an already-running client.
  if (since > hostVersion) return true;
  return oldestRetainedVersion !== undefined && since < oldestRetainedVersion - 1;
}

/** Test/teardown helper — reset the authority log + out-of-band asset store (does not touch the registry). */
export function resetProjectSyncLog(): void {
  hostVersion = 0;
  eventLog.length = 0;
  waiters.clear();
  syncAssets.clear();
  syncAssetChars = 0;
  retainedSyncAssetKeysByChannel.clear();
  stagedSyncAssetKeysByChannel.clear();
}

// ---------------------------------------------------------------------------------------------------
// Host-authority out-of-band asset store (content-addressed binary payloads, task #53)
// ---------------------------------------------------------------------------------------------------

/**
 * Some channels (Image) carry payloads too large for the JSON op stream — a layer's pixels are a
 * multi-MB OffscreenCanvas. Those bytes travel out-of-band, content-addressed by `${layerId}@${version}`,
 * over `PUT`/`GET /project/:channel/asset/:assetId`. The phone authority caches them here, keyed by
 * channel + assetId. Because the key is the content version, a stored asset is effectively immutable and
 * a receiver never re-fetches a version it already holds — what makes even a full snapshot cheap.
 * Bounded (LRU by insertion) so a long paint session can't grow the cache without limit.
 */
const MAX_SYNC_ASSETS = 256;
/** A complete Paper workspace may legitimately exceed the transient 256-record tail, but a paired
 * peer must not be able to pin an unbounded inventory or a phone-sized heap of encoded payloads. */
export const MAX_PROJECT_SYNC_ASSET_INVENTORY = 4_096;
export const MAX_PROJECT_SYNC_ASSET_DATA_URL_CHARS = 128 * 1024 * 1024;
const MAX_PROJECT_SYNC_ASSET_TOTAL_CHARS = 512 * 1024 * 1024;
const syncAssets = new Map<string, string>();
let syncAssetChars = 0;
const retainedSyncAssetKeysByChannel = new Map<ProjectSyncChannelId, Set<string>>();
const stagedSyncAssetKeysByChannel = new Map<ProjectSyncChannelId, Set<string>>();

const syncAssetKey = (channel: ProjectSyncChannelId, assetId: string): string =>
  `${channel}\u0000${assetId}`;

function deleteSyncAsset(key: string): boolean {
  const value = syncAssets.get(key);
  if (value === undefined) return false;
  syncAssets.delete(key);
  syncAssetChars -= value.length;
  return true;
}

function evictUnretainedSyncAssets(): void {
  while (syncAssets.size > MAX_SYNC_ASSETS || syncAssetChars > MAX_PROJECT_SYNC_ASSET_TOTAL_CHARS) {
    let oldestUnretained: string | undefined;
    for (const key of syncAssets.keys()) {
      const retained = [...retainedSyncAssetKeysByChannel.values(), ...stagedSyncAssetKeysByChannel.values()]
        .some((set) => set.has(key));
      if (!retained) {
        oldestUnretained = key;
        break;
      }
    }
    if (oldestUnretained === undefined) break;
    deleteSyncAsset(oldestUnretained);
  }
}

/**
 * Pin a proposed inventory while its bytes and workspace envelope are still in flight. Staging never
 * prunes the last accepted inventory; only a successfully applied envelope may replace that baseline.
 */
export function stageProjectSyncAssets(
  channel: ProjectSyncChannelId,
  assetIds: readonly string[],
): boolean {
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length > MAX_PROJECT_SYNC_ASSET_INVENTORY) return false;
  stagedSyncAssetKeysByChannel.set(channel, new Set(uniqueIds.map((assetId) => syncAssetKey(channel, assetId))));
  evictUnretainedSyncAssets();
  return true;
}

/**
 * Pin one channel's complete current asset inventory. Paper can legitimately reach more than the
 * generic 256-entry paint-cache tail; replacing the inventory prunes obsolete records while keeping
 * every current content hash fetchable until the next workspace envelope supersedes it.
 */
export function retainProjectSyncAssets(
  channel: ProjectSyncChannelId,
  assetIds: readonly string[],
): boolean {
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length > MAX_PROJECT_SYNC_ASSET_INVENTORY) return false;
  const retained = new Set(uniqueIds.map((assetId) => syncAssetKey(channel, assetId)));
  retainedSyncAssetKeysByChannel.set(channel, retained);
  stagedSyncAssetKeysByChannel.delete(channel);
  for (const key of [...syncAssets.keys()]) {
    const separatorIndex = key.indexOf('\0');
    const keyChannel = separatorIndex >= 0 ? key.slice(0, separatorIndex) : '';
    if (keyChannel === channel && !retained.has(key)) deleteSyncAsset(key);
  }
  evictUnretainedSyncAssets();
  return syncAssetChars <= MAX_PROJECT_SYNC_ASSET_TOTAL_CHARS;
}

/** Cache an out-of-band asset (base64 data URL) under its content-addressed key, evicting unpinned tails. */
export function recordProjectSyncAsset(
  channel: ProjectSyncChannelId,
  assetId: string,
  dataUrl: string,
): boolean {
  if (!assetId || dataUrl.length > MAX_PROJECT_SYNC_ASSET_DATA_URL_CHARS) return false;
  const key = syncAssetKey(channel, assetId);
  const previous = syncAssets.get(key);
  if (previous !== undefined) deleteSyncAsset(key); // refresh LRU recency on re-insert
  syncAssets.set(key, dataUrl);
  syncAssetChars += dataUrl.length;
  evictUnretainedSyncAssets();
  if (syncAssetChars <= MAX_PROJECT_SYNC_ASSET_TOTAL_CHARS) return true;

  // Every remaining record is pinned. Reject the new payload and restore an existing immutable value
  // instead of silently letting a trusted-but-buggy peer exhaust the phone's JS heap.
  deleteSyncAsset(key);
  if (previous !== undefined) {
    syncAssets.set(key, previous);
    syncAssetChars += previous.length;
  }
  return false;
}

/** Read a cached out-of-band asset, or null if this authority doesn't hold that content version. */
export function getHostProjectSyncAsset(channel: ProjectSyncChannelId, assetId: string): string | null {
  return syncAssets.get(syncAssetKey(channel, assetId)) ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Channel registry (each workspace registers exactly one channel)
// ---------------------------------------------------------------------------------------------------

const channels = new Map<ProjectSyncChannelId, ProjectSyncChannel>();

/** Register (or replace) a workspace's sync channel. Idempotent per id — last registration wins. */
export function registerProjectSyncChannel<TChange>(channel: ProjectSyncChannel<TChange>): void {
  channels.set(channel.id, channel as ProjectSyncChannel);
}

export function getProjectSyncChannel(id: ProjectSyncChannelId): ProjectSyncChannel | undefined {
  return channels.get(id);
}

export function getRegisteredProjectSyncChannelIds(): ProjectSyncChannelId[] {
  return [...channels.keys()];
}

/** Test/teardown helper — drop all registered channels. */
export function clearProjectSyncChannels(): void {
  channels.clear();
}
