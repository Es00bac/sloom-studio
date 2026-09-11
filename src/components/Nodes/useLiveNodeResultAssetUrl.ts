import { isServedLanSession } from '../../lib/remoteHostClient';
import { useSourceBinStore } from '../../store/sourceBinStore';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';

/**
 * Pure resolver behind {@link useLiveNodeResultAssetUrl} (extracted so it is unit-testable without React).
 *
 * Picks the source-bin item that backs a media node's generated result and returns its CURRENT `assetUrl`
 * when that URL is loadable in this origin. Preference order: the selected attempt's `sourceBinItemId`
 * (most precise), then structural linkage for pre-existing nodes that predate per-attempt ids (generated
 * items carry `originNodeId === this node`, taking the most recent on ties). On a served LAN browser only a
 * `data:` URL is loadable (the item's own `blob:`/capacitor URL is phone-local); off a served session every
 * local URL paints.
 */
export function resolveLiveNodeResultAssetUrl(
  items: readonly SourceBinLibraryItem[],
  params: { nodeId: string; enabled: boolean; resultSourceBinItemId?: string; servedSession: boolean },
): string | undefined {
  const { nodeId, enabled, resultSourceBinItemId, servedSession } = params;
  if (!enabled) {
    return undefined;
  }

  const linked =
    (resultSourceBinItemId ? items.find((item) => item.id === resultSourceBinItemId) : undefined) ??
    items
      .filter(
        (item) =>
          item.originNodeId === nodeId ||
          (typeof item.originNodeId === 'string' && item.originNodeId.startsWith(`${nodeId}:`)),
      )
      .reduce<SourceBinLibraryItem | undefined>(
        (best, item) => (!best || item.createdAt > best.createdAt ? item : best),
        undefined,
      );

  const url = linked?.assetUrl;
  return typeof url === 'string' && url.length > 0 && (!servedSession || url.startsWith('data:'))
    ? url
    : undefined;
}

/**
 * Resolve the CURRENT, still-valid display URL for a media node's generated result from the source-bin
 * store (the asset's authority) — for every session, not just served ones.
 *
 * A node's `data.result` is the `assetUrl` the source-bin store handed back when the asset was generated.
 * For IndexedDB-/scratch-backed assets that is a `blob:` object URL whose lifetime the store OWNS: it
 * revokes that URL the moment the item is rehydrated or reconciled (the handle pool's `replace`/`release`),
 * which leaves the node's cached `data.result` pointing at a REVOKED blob. A revoked blob URL fails to load
 * (the broken-image / broken-thumbnail glyph) even though the bytes are still on disk / in IndexedDB.
 *
 * Reading the linked item's `assetUrl` reactively means we always render the store's still-valid URL: when
 * the store revokes+replaces, this selector re-runs and hands back the fresh one. Returns `undefined` when
 * disabled (e.g. import mode) or when no loadable linked URL exists, so callers fall back to their own
 * resolution (served remote fetch, the cached `data.result`, …).
 */
export function useLiveNodeResultAssetUrl(params: {
  nodeId: string;
  enabled: boolean;
  resultSourceBinItemId?: string;
}): string | undefined {
  const servedSession = isServedLanSession();
  return useSourceBinStore((state) =>
    resolveLiveNodeResultAssetUrl(state.getAllItems(), { ...params, servedSession }),
  );
}
