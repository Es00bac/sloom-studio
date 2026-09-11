import { setServedProjectMutationPublisher } from './androidLanServer';
import { getRemoteHostSessionEpoch, isServedLanSession, remoteHostFetch } from './remoteHostClient';
import {
  getProjectSyncChannel,
  getRegisteredProjectSyncChannelIds,
  type ProjectSyncChannelId,
  type ProjectSyncEvent,
} from './projectSyncService';

/**
 * Generic served-client half of the unified op-sync (task #51+). The source library still runs its own
 * bespoke seed/subscribe in [[remoteHostClient]]; this is the **workspace-agnostic** loop that drives
 * every *registered* channel (Flow today; Paper/Image next) over the `/project/:channel/*` transport:
 *
 *  - **seed** `GET /project/:channel/snapshot` → `channel.applyRemote(snapshot-op)`,
 *  - **subscribe** one multiplexed long-poll `GET /project/events?since=N` and dispatch by channel,
 *  - **publish** `notifyLanProjectChange` → `POST /project/:channel/mutate` (registered seam below).
 *
 * All applies go through the channel's `applyRemote`, which is non-broadcasting (the echo-loop rule lives
 * in each channel, e.g. `flowSyncChannel`'s guard). Ops are id-addressed + idempotent, so a self-echoed
 * mutation is a no-op. No websocket/SSE — long-poll only (lan-host-security-and-sync).
 */

interface StartedChannel {
  runId: symbol;
  /** Authority version included by this channel's latest accepted snapshot/event. */
  version: number | null;
  /** Events arriving while this channel's snapshot is in flight; replayed after the seed. */
  pendingEvents: ProjectSyncEvent[];
  replaying: boolean;
  requiresRepair: boolean;
}

const startedChannels = new Map<ProjectSyncChannelId, StartedChannel>();
let subscriberRun: { runId: symbol; expectedEpoch: number } | null = null;
let multiplexUnavailableEpoch: number | null = null;
const legacySubscriberRuns = new Map<ProjectSyncChannelId, symbol>();
const mutationPublishTails = new Map<ProjectSyncChannelId, Promise<void>>();
const MUTATION_TRANSPORT_ATTEMPTS = 3;
const MUTATION_TRANSPORT_TIMEOUT_MS = 15_000;
const MAX_PENDING_SEED_EVENTS = 512;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Pre-multiplex phone builds expose one event poll per channel. Keep that path as a compatibility
 * fallback so updating the desktop app never turns an older installed phone into a seed-only viewer. */
function startLegacyChannelSubscriber(
  channelId: ProjectSyncChannelId,
  initialVersion: number,
  expectedEpoch: number,
): void {
  if (legacySubscriberRuns.has(channelId)) return;
  const runId = Symbol(`legacy-${channelId}`);
  legacySubscriberRuns.set(channelId, runId);
  let since = initialVersion;
  const loop = async () => {
    try {
      while (isServedLanSession() && expectedEpoch === getRemoteHostSessionEpoch()
        && legacySubscriberRuns.get(channelId) === runId) {
        let res: Response | null;
        try {
          res = await remoteHostFetch(`/project/${encodeURIComponent(channelId)}/events?since=${since}`, {
            timeoutMs: 35_000,
          });
        } catch {
          await delay(3000);
          continue;
        }
        if (!res || expectedEpoch !== getRemoteHostSessionEpoch()) break;
        if (!res.ok) {
          await delay(3000);
          continue;
        }
        const payload = await res.json().catch(() => null) as
          | { version?: number; events?: ProjectSyncEvent[]; gap?: boolean }
          | null;
        const marker = startedChannels.get(channelId);
        if (!marker || marker.version === null) break;
        if (payload?.gap) {
          const repairedVersion = await seedChannel(channelId, expectedEpoch);
          if (repairedVersion >= 0 && startedChannels.get(channelId)?.runId === marker.runId) {
            marker.version = repairedVersion;
            since = repairedVersion;
          } else {
            await delay(3000);
          }
          continue;
        }
        for (const event of payload?.events ?? []) {
          if (event.channel !== channelId || event.version <= marker.version) continue;
          const channel = getProjectSyncChannel(channelId);
          try {
            if (channel) await channel.applyRemote(event.change);
            marker.version = event.version;
          } catch {
            const repairedVersion = await seedChannel(channelId, expectedEpoch);
            if (repairedVersion >= 0) marker.version = repairedVersion;
          }
        }
        since = Math.max(since, marker.version, typeof payload?.version === 'number' ? payload.version : 0);
        if ((payload?.events?.length ?? 0) === 0) await delay(500);
      }
    } finally {
      if (legacySubscriberRuns.get(channelId) === runId) legacySubscriberRuns.delete(channelId);
    }
  };
  void loop();
}

/** Pull the channel's snapshot and apply it as the seed. Returns the authority version, or -1 on failure. */
async function seedChannel(channelId: ProjectSyncChannelId, expectedEpoch: number): Promise<number> {
  try {
    const res = await remoteHostFetch(`/project/${encodeURIComponent(channelId)}/snapshot`, { timeoutMs: 8000 });
    if (!res || !res.ok || expectedEpoch !== getRemoteHostSessionEpoch()) return -1;

    const payload = (await res.json().catch(() => null)) as { snapshot?: unknown; version?: number } | null;
    if (!payload || expectedEpoch !== getRemoteHostSessionEpoch()) return -1;
    const version = typeof payload.version === 'number' ? payload.version : 0;

    const channel = getProjectSyncChannel(channelId);
    if (channel && payload.snapshot != null) {
      await channel.applyRemote(payload.snapshot);
      if (expectedEpoch !== getRemoteHostSessionEpoch()) return -1;
    }
    return version;
  } catch {
    return -1;
  }
}

/**
 * Long-poll the shared project log once and dispatch every event by channel. Browsers commonly allow
 * only six HTTP/1.1 connections per origin; one poll per workspace plus Source Library exhausted that
 * pool and starved urgent lock/mutation POSTs until they timed out. The host log was designed around a
 * global cursor, so multiplexing here both matches that contract and leaves ample request capacity.
 */
function startSubscriber(
  initialVersion: number,
  expectedEpoch: number,
  runId: symbol,
): void {
  let since = initialVersion;
  const loop = async () => {
    try {
      while (isServedLanSession() && expectedEpoch === getRemoteHostSessionEpoch()) {
        let res: Response | null;
        try {
          res = await remoteHostFetch(`/project/events?since=${since}`, {
            timeoutMs: 35_000,
          });
        } catch {
          await delay(3000);
          continue;
        }
        if (expectedEpoch !== getRemoteHostSessionEpoch()) break;
        if (!res) break; // token cleared (unpaired)
        if (!res.ok) {
          if (res.status === 404) {
            multiplexUnavailableEpoch = expectedEpoch;
            for (const [channelId, marker] of startedChannels) {
              if (marker.version !== null) startLegacyChannelSubscriber(channelId, marker.version, expectedEpoch);
            }
            break;
          }
          await delay(3000);
          continue;
        }

        const payload = (await res.json().catch(() => null)) as
          | { version?: number; events?: ProjectSyncEvent[]; gap?: boolean }
          | null;
        if (payload?.gap) {
          const repairedVersions: number[] = [];
          let repairFailed = false;
          for (const [channelId, marker] of [...startedChannels]) {
            if (marker.version === null) continue;
            const repairedVersion = await seedChannel(channelId, expectedEpoch);
            if (expectedEpoch !== getRemoteHostSessionEpoch()) break;
            const current = startedChannels.get(channelId);
            if (repairedVersion < 0 || current?.runId !== marker.runId) {
              repairFailed = true;
              continue;
            }
            current.version = repairedVersion;
            repairedVersions.push(repairedVersion);
          }
          if (expectedEpoch !== getRemoteHostSessionEpoch()) break;
          if (repairFailed || repairedVersions.length === 0) await delay(3000);
          else since = Math.min(...repairedVersions);
          continue;
        }
        const events = payload?.events ?? [];
        for (const event of events) {
          if (expectedEpoch !== getRemoteHostSessionEpoch()) break;
          const marker = startedChannels.get(event.channel);
          if (!marker) continue;
          if (marker.version === null || marker.replaying) {
            marker.pendingEvents.push(event);
            if (marker.pendingEvents.length > MAX_PENDING_SEED_EVENTS) {
              marker.pendingEvents.splice(0, marker.pendingEvents.length - MAX_PENDING_SEED_EVENTS);
              marker.requiresRepair = true;
            }
            continue;
          }
          if (event.version <= marker.version) continue;
          const channel = getProjectSyncChannel(event.channel);
          try {
            if (channel) await channel.applyRemote(event.change);
            const current = startedChannels.get(event.channel);
            if (current?.runId === marker.runId) current.version = event.version;
          } catch {
            // Repair only the rejecting channel. Other channel ops in this global batch remain valid.
            const repairedVersion = await seedChannel(event.channel, expectedEpoch);
            const current = startedChannels.get(event.channel);
            if (repairedVersion >= 0 && current?.runId === marker.runId) current.version = repairedVersion;
          }
        }
        if (expectedEpoch !== getRemoteHostSessionEpoch()) break;
        if (typeof payload?.version === 'number' && payload.version > since) since = payload.version;
        if (events.length === 0) await delay(500); // guard against a non-holding host hot-looping
      }
    } finally {
      // An old phone's delayed poll may finish after a new session has installed a replacement.
      if (subscriberRun?.runId === runId) subscriberRun = null;
    }
  };
  void loop().catch(() => {
    if (subscriberRun?.runId === runId) subscriberRun = null;
  });
}

function ensureSubscriberStarted(initialVersion: number, expectedEpoch: number): void {
  if (subscriberRun?.expectedEpoch === expectedEpoch) return;
  const runId = Symbol('project-sync');
  subscriberRun = { runId, expectedEpoch };
  startSubscriber(initialVersion, expectedEpoch, runId);
}

async function replayEventsBufferedDuringSeed(
  channelId: ProjectSyncChannelId,
  marker: StartedChannel,
  expectedEpoch: number,
): Promise<boolean> {
  marker.replaying = true;
  try {
    if (marker.requiresRepair) {
      const repairedVersion = await seedChannel(channelId, expectedEpoch);
      if (repairedVersion < 0 || startedChannels.get(channelId)?.runId !== marker.runId) return false;
      marker.version = repairedVersion;
      marker.requiresRepair = false;
    }

    while (marker.pendingEvents.length > 0) {
      const events = marker.pendingEvents.splice(0).sort((left, right) => left.version - right.version);
      for (const event of events) {
        if (expectedEpoch !== getRemoteHostSessionEpoch()
          || startedChannels.get(channelId)?.runId !== marker.runId) return false;
        if (event.channel !== channelId || marker.version === null || event.version <= marker.version) continue;
        const channel = getProjectSyncChannel(channelId);
        try {
          if (channel) await channel.applyRemote(event.change);
          marker.version = event.version;
        } catch {
          const repairedVersion = await seedChannel(channelId, expectedEpoch);
          if (repairedVersion < 0 || startedChannels.get(channelId)?.runId !== marker.runId) return false;
          marker.version = repairedVersion;
        }
      }
      if (marker.requiresRepair) {
        const repairedVersion = await seedChannel(channelId, expectedEpoch);
        if (repairedVersion < 0 || startedChannels.get(channelId)?.runId !== marker.runId) return false;
        marker.version = repairedVersion;
        marker.requiresRepair = false;
      }
    }
    return true;
  } finally {
    if (startedChannels.get(channelId)?.runId === marker.runId) marker.replaying = false;
  }
}

/**
 * Begin syncing one registered channel if this is a served session and it isn't already running.
 * Idempotent. A seed failure (e.g. not yet paired → no token) is released so a later trigger can retry.
 */
export async function ensureProjectSyncChannelStarted(channelId: ProjectSyncChannelId): Promise<void> {
  if (!isServedLanSession()) return;
  if (startedChannels.has(channelId)) return;
  const expectedEpoch = getRemoteHostSessionEpoch();
  const runId = Symbol(channelId);
  startedChannels.set(channelId, {
    runId,
    version: null,
    pendingEvents: [],
    replaying: false,
    requiresRepair: false,
  });

  const version = await seedChannel(channelId, expectedEpoch);
  if (version < 0 || expectedEpoch !== getRemoteHostSessionEpoch()) {
    if (startedChannels.get(channelId)?.runId === runId) startedChannels.delete(channelId);
    return;
  }
  const marker = startedChannels.get(channelId);
  if (marker?.runId !== runId) return;
  marker.version = version;
  if (multiplexUnavailableEpoch === expectedEpoch) {
    startLegacyChannelSubscriber(channelId, version, expectedEpoch);
  } else {
    ensureSubscriberStarted(version, expectedEpoch);
  }
  await replayEventsBufferedDuringSeed(channelId, marker, expectedEpoch);
}

/** Start every channel registered so far. Called once a served session pairs + seeds. */
export function startAllRegisteredProjectChannels(): void {
  for (const id of getRegisteredProjectSyncChannelIds()) {
    void ensureProjectSyncChannelStarted(id);
  }
}

/**
 * Push a local op on `channel` to the phone. No-ops off a served session. The bearer session is the
 * transport identity; the phone resolves the device server-side for authority-sensitive channels.
 * Current simultaneous hosts order every accepted peer mutation in one authority log and do not gate
 * it on the legacy presence baton.
 */
async function sendProjectMutation(
  channel: ProjectSyncChannelId,
  change: unknown,
  expectedEpoch: number,
): Promise<boolean> {
  if (!isServedLanSession() || expectedEpoch !== getRemoteHostSessionEpoch()) return false;
  // One stable id spans every transport retry. If the authority committed the first request but its
  // response vanished, the retry receives the cached acknowledgement without re-applying the op.
  const mutationId = encodeURIComponent(globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  for (let attempt = 1; attempt <= MUTATION_TRANSPORT_ATTEMPTS; attempt += 1) {
    if (!isServedLanSession() || expectedEpoch !== getRemoteHostSessionEpoch()) return false;
    try {
      const response = await remoteHostFetch(
        `/project/${encodeURIComponent(channel)}/mutate?mutation=${mutationId}`,
        {
        method: 'POST',
        body: JSON.stringify(change),
        // A Wi-Fi drop can otherwise leave the platform fetch in TCP retry indefinitely. Since
        // mutation delivery is serialized per channel, one black-holed request would also block
        // every later operation on that channel. The schemas are idempotent, so timeout + retry is
        // safe even when the authority committed the first request but its response was lost.
        timeoutMs: MUTATION_TRANSPORT_TIMEOUT_MS,
        },
      );
      if (response?.ok) {
        const payload = await response.json().catch(() => null) as { ok?: boolean } | null;
        // The native relay returns HTTP 200 for the JS handler's structured body, including caught
        // failures. Only an explicit positive acknowledgement advances a channel baseline.
        return payload?.ok === true;
      }
      if (response && response.status >= 400 && response.status < 500) return false;
    } catch {
      // A dropped request is retryable below. The operation schema is idempotent, so a response lost
      // after host commit is safe: redelivery is a no-op at the workspace reducer.
    }
    if (attempt < MUTATION_TRANSPORT_ATTEMPTS) await delay(250 * attempt);
  }
  return false;
}

/**
 * Serialize mutations per channel. Flow/Paper/Image emitters intentionally do not block their UI on
 * the network, but their ordered op stream still must not overtake itself and a transient dropped POST
 * must not disappear merely because those callers ignore the returned promise. Video additionally
 * awaits this acknowledgement before advancing its own composition baseline.
 */
function publishProjectMutation(channel: ProjectSyncChannelId, change: unknown): Promise<boolean> {
  if (!isServedLanSession()) return Promise.resolve(false);
  const expectedEpoch = getRemoteHostSessionEpoch();
  const previousTail = mutationPublishTails.get(channel) ?? Promise.resolve();
  const result = previousTail
    .catch(() => undefined)
    .then(() => sendProjectMutation(channel, change, expectedEpoch));
  const nextTail = result.then(() => undefined, () => undefined);
  mutationPublishTails.set(channel, nextTail);
  void nextTail.finally(() => {
    if (mutationPublishTails.get(channel) === nextTail) mutationPublishTails.delete(channel);
  });
  return result;
}

/** Stop the logical session immediately; in-flight fetches may finish, but their epoch guards discard them. */
export function stopAllProjectSyncChannels(): void {
  startedChannels.clear();
  subscriberRun = null;
  multiplexUnavailableEpoch = null;
  legacySubscriberRuns.clear();
  mutationPublishTails.clear();
}

/** Test-only: forget which channels have started so a fresh session can re-seed. */
export function __resetProjectSyncClientForTests(): void {
  stopAllProjectSyncChannels();
}

// Register the served publisher seam at module load; it no-ops until a served+paired session exists.
setServedProjectMutationPublisher(publishProjectMutation);
