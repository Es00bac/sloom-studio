import { useEffect, useMemo, useState } from 'react';
import type { SourceBinLibraryItem } from '../../../store/sourceBinStore';
import type { PaperFrameAsset } from '../../../types/paper';
import { resolvePaperFrameAssetUrl } from '../../../lib/paperAssetReferences';
import { paperAssetUrlRegistry } from './PaperAssetRuntime';

/**
 * Resolves a Paper asset for a live renderer. Managed records receive a leased object URL; that URL stays
 * component-local and is revoked when no renderer still needs it, never entering document/history state.
 */
export function usePaperAssetUrl(
  asset: PaperFrameAsset | undefined,
  sourceItem?: Pick<SourceBinLibraryItem, 'id' | 'assetUrl'>,
): string | undefined {
  const directUrl = useMemo(
    () => resolvePaperFrameAssetUrl(asset, sourceItem),
    [asset, sourceItem],
  );
  const managedAssetRef = asset?.locator?.kind === 'managed' ? asset.locator.ref : undefined;
  const managedAssetId = managedAssetRef?.id;
  const managedAssetKey = managedAssetRef
    ? `${managedAssetRef.id}:${managedAssetRef.sha256}:${managedAssetRef.mimeType}:${managedAssetRef.byteLength}`
    : undefined;
  const [managedLease, setManagedLease] = useState<{ key: string; url: string } | undefined>();

  useEffect(() => {
    if (!managedAssetId) {
      return undefined;
    }

    let active = true;
    let release: (() => void) | undefined;
    void paperAssetUrlRegistry.acquire(managedAssetRef!)
      .then((lease) => {
        if (!active) {
          lease.release();
          return;
        }
        release = lease.release;
        setManagedLease({ key: managedAssetKey!, url: lease.url });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      release?.();
    };
  }, [managedAssetId, managedAssetKey, managedAssetRef]);

  return directUrl ?? (managedLease && managedLease.key === managedAssetKey ? managedLease.url : undefined);
}
