import { isAndroidLanServerAvailable } from './androidLanServer';
import {
  getHostProjectSyncAsset,
  MAX_PROJECT_SYNC_ASSET_DATA_URL_CHARS,
  recordProjectSyncAsset,
  retainProjectSyncAssets,
  stageProjectSyncAssets,
  type ProjectSyncChannelId,
} from './projectSyncService';
import { isServedLanSession, remoteHostFetch } from './remoteHostClient';

/**
 * Out-of-band binary transport for channel payloads too large for the JSON op stream — the Image
 * channel's layer pixels (task #53). Content-addressed by `${layerId}@${bitmapVersion}`. Role-branched
 * exactly like {@link notifyLanProjectChange}:
 *
 *  - **phone authority** → read/write the host-local cache directly (same process, no network),
 *  - **served client** → `PUT`/`GET /project/:channel/asset/:assetId` over the plain-HTTP relay,
 *  - **any other session** (normal web/desktop) → no-op (`get` returns null), so non-sync sessions
 *    never touch the network.
 *
 * The address is the content version, so an asset is immutable once stored and a receiver fetches a
 * given `layerId@version` at most once — re-seeding or a self-echoed op costs no extra bytes.
 */

const assetPath = (channel: ProjectSyncChannelId, assetId: string): string =>
  `/project/${encodeURIComponent(channel)}/asset/${encodeURIComponent(assetId)}`;

const assetInventoryPath = (channel: ProjectSyncChannelId): string =>
  `/project/${encodeURIComponent(channel)}/assets`;
const ASSET_TRANSPORT_ATTEMPTS = 3;
const ASSET_TRANSPORT_TIMEOUT_MS = 30_000;
const DIRECT_PROJECT_ASSET_CHARACTERS = 512 * 1024;
const PROJECT_ASSET_CHUNK_CHARACTERS = 512 * 1024;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function putServedAssetJson(path: string, body: unknown): Promise<boolean> {
  for (let attempt = 1; attempt <= ASSET_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      const response = await remoteHostFetch(path, {
        method: 'PUT',
        body: JSON.stringify(body),
        timeoutMs: ASSET_TRANSPORT_TIMEOUT_MS,
      });
      if (response?.ok) {
        const payload = await response.json().catch(() => null) as { ok?: boolean } | null;
        return payload?.ok === true;
      }
      if (response && response.status >= 400 && response.status < 500) return false;
    } catch {
      // Retry the same immutable id/body below.
    }
    if (attempt < ASSET_TRANSPORT_ATTEMPTS) await delay(250 * attempt);
  }
  return false;
}

async function putServedProjectAsset(
  channel: ProjectSyncChannelId,
  assetId: string,
  dataUrl: string,
): Promise<boolean> {
  if (dataUrl.length > MAX_PROJECT_SYNC_ASSET_DATA_URL_CHARS) return false;
  if (dataUrl.length <= DIRECT_PROJECT_ASSET_CHARACTERS) {
    return putServedAssetJson(assetPath(channel, assetId), { asset: dataUrl });
  }

  const basePath = `/project/${encodeURIComponent(channel)}/asset-upload/${encodeURIComponent(assetId)}`;
  const uploadId = globalThis.crypto?.randomUUID?.()
    ?? `project-asset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const chunkCount = Math.ceil(dataUrl.length / PROJECT_ASSET_CHUNK_CHARACTERS);
  const began = await putServedAssetJson(`${basePath}/begin`, {
    uploadId,
    totalLength: dataUrl.length,
    chunkCount,
  });
  if (!began) return false;

  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = dataUrl.slice(
      index * PROJECT_ASSET_CHUNK_CHARACTERS,
      (index + 1) * PROJECT_ASSET_CHUNK_CHARACTERS,
    );
    const accepted = await putServedAssetJson(`${basePath}/chunk/${index}`, { uploadId, chunk });
    if (!accepted) {
      void putServedAssetJson(`${basePath}/abort`, { uploadId });
      return false;
    }
  }
  return putServedAssetJson(`${basePath}/commit`, { uploadId });
}

/**
 * Declare a channel's complete immutable inventory before uploading it. The authority pins these
 * hashes together, so a workspace with more than the generic cache tail cannot evict its own first
 * records before the final envelope becomes visible.
 */
export async function prepareVerifiedProjectSyncAssets(
  channel: ProjectSyncChannelId,
  assetIds: readonly string[],
): Promise<boolean> {
  // Android can also be the client in a Sloom → Hane phone/tablet pairing. An active served
  // session therefore takes precedence over the device's merely-available local LAN server;
  // otherwise cross-device pixels are incorrectly looked up in this device's empty host cache.
  if (isServedLanSession()) {
    return putServedAssetJson(assetInventoryPath(channel), { assetIds });
  }
  return isAndroidLanServerAvailable()
    ? stageProjectSyncAssets(channel, assetIds)
    : false;
}

/** Replace the authority's accepted inventory only after its envelope has applied successfully. */
export async function commitVerifiedProjectSyncAssets(
  channel: ProjectSyncChannelId,
  assetIds: readonly string[],
): Promise<boolean> {
  // Served peers finalize through the authority's successful channel apply.
  if (isServedLanSession()) return true;
  if (isAndroidLanServerAvailable()) {
    return retainProjectSyncAssets(channel, assetIds);
  }
  return false;
}

/** Make a layer's encoded pixels (a base64 PNG data URL) available to other devices on this channel. */
export async function putProjectSyncAsset(
  channel: ProjectSyncChannelId,
  assetId: string,
  dataUrl: string,
): Promise<boolean> {
  if (isServedLanSession()) {
    return putServedProjectAsset(channel, assetId, dataUrl);
  }
  if (isAndroidLanServerAvailable()) {
    return recordProjectSyncAsset(channel, assetId, dataUrl);
  }
  return false;
}

/**
 * Store an asset and report whether the authority acknowledged it. Metadata-first channels such as
 * Paper must not publish references after a best-effort upload: a false result keeps the entire
 * workspace envelope deferred. The historical void helper above remains for Image's retry-tolerant
 * pixel stream.
 */
export async function putVerifiedProjectSyncAsset(
  channel: ProjectSyncChannelId,
  assetId: string,
  dataUrl: string,
): Promise<boolean> {
  if (isServedLanSession()) {
    return putServedProjectAsset(channel, assetId, dataUrl);
  }
  if (isAndroidLanServerAvailable()) {
    return recordProjectSyncAsset(channel, assetId, dataUrl);
  }
  return false;
}

/** Fetch a content-addressed asset's bytes (base64 PNG data URL), or null if unavailable. */
export async function getProjectSyncAsset(
  channel: ProjectSyncChannelId,
  assetId: string,
): Promise<string | null> {
  if (isServedLanSession()) {
    let res: Response | null;
    try {
      res = await remoteHostFetch(assetPath(channel, assetId), { timeoutMs: ASSET_TRANSPORT_TIMEOUT_MS });
    } catch {
      return null;
    }
    if (!res || !res.ok) return null;
    const body = (await res.json().catch(() => null)) as { asset?: string | null } | null;
    return body?.asset ?? null;
  }
  return isAndroidLanServerAvailable()
    ? getHostProjectSyncAsset(channel, assetId)
    : null;
}
