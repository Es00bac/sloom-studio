import type { SourceBin, SourceBinLibraryItem } from '../../sourceBinStore';
import type { SourceBinProfessionalMediaState } from '../../../types/videoProfessional';

export function findBinIndexContainingItem(bins: SourceBin[], itemId: string): number {
  return bins.findIndex((bin) => bin.items.some((item) => item.id === itemId));
}

export function toggleSourceBinItemStarred(bins: SourceBin[], id: string): SourceBin[] | undefined {
  return updateSourceBinItem(bins, id, (item) => ({ ...item, starred: !item.starred }));
}

export function setSourceBinItemCollapsed(bins: SourceBin[], id: string, collapsed: boolean): SourceBin[] | undefined {
  return updateSourceBinItem(bins, id, (item) => ({ ...item, collapsed }));
}

export function renameSourceBinItem(bins: SourceBin[], id: string, label: string): SourceBin[] | undefined {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) {
    return undefined;
  }

  return updateSourceBinItem(bins, id, (item) => ({ ...item, label: normalizedLabel }));
}

export function updateSourceBinItemProfessionalState(
  bins: SourceBin[],
  id: string,
  professional: SourceBinProfessionalMediaState,
): SourceBin[] | undefined {
  return updateSourceBinItem(bins, id, (item) => ({ ...item, professional }));
}

export function setSourceBinEnvelopeCollapsed(
  bins: SourceBin[],
  envelopeId: string,
  envelopeCollapsed: boolean,
): SourceBin[] | undefined {
  if (!envelopeId.trim()) {
    return undefined;
  }

  let didUpdate = false;
  const nextBins = bins.map((bin) => ({
    ...bin,
    items: bin.items.map((item) => {
      if (item.envelopeId !== envelopeId) {
        return item;
      }

      didUpdate = true;
      return { ...item, envelopeCollapsed };
    }),
  }));

  return didUpdate ? nextBins : undefined;
}

export function setAllSourceBinItemsCollapsed(bins: SourceBin[], collapsed: boolean): SourceBin[] {
  return bins.map((bin) => ({
    ...bin,
    items: bin.items.map((item) => ({
      ...item,
      collapsed,
      ...(item.envelopeId ? { envelopeCollapsed: collapsed } : {}),
    })),
  }));
}

export function removeSourceBinItem(
  bins: SourceBin[],
  id: string,
): { bins: SourceBin[]; removedItem: SourceBinLibraryItem } | undefined {
  const binIndex = findBinIndexContainingItem(bins, id);
  if (binIndex < 0) {
    return undefined;
  }

  const existingItem = bins[binIndex].items.find((item) => item.id === id);
  if (!existingItem) {
    return undefined;
  }

  return {
    bins: bins.map((bin, index) =>
      index === binIndex ? { ...bin, items: bin.items.filter((item) => item.id !== id) } : bin,
    ),
    removedItem: existingItem,
  };
}

function updateSourceBinItem(
  bins: SourceBin[],
  id: string,
  update: (item: SourceBinLibraryItem) => SourceBinLibraryItem,
): SourceBin[] | undefined {
  const binIndex = findBinIndexContainingItem(bins, id);
  if (binIndex < 0) {
    return undefined;
  }

  return bins.map((bin, index) =>
    index === binIndex
      ? { ...bin, items: bin.items.map((item) => (item.id === id ? update(item) : item)) }
      : bin,
  );
}
