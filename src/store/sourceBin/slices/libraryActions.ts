import type { SourceBin, SourceBinLibraryItem } from '../../sourceBinStore';

export function createSourceBin(name: string | undefined, now = Date.now()): SourceBin {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `bin-${now}`,
    name: name?.trim() || 'New Bin',
    items: [],
    collapsed: false,
    createdAt: now,
  };
}

export function renameSourceBin(bins: SourceBin[], id: string, name: string): SourceBin[] {
  return bins.map((bin) => (bin.id === id ? { ...bin, name: name.trim() || bin.name } : bin));
}

export function removeSourceBin(bins: SourceBin[], id: string): SourceBin[] | undefined {
  if (bins.length <= 1) {
    return undefined;
  }

  const targetBin = bins.find((bin) => bin.id === id);
  if (!targetBin) {
    return undefined;
  }

  const remainingBins = bins.filter((bin) => bin.id !== id);
  if (targetBin.items.length === 0) {
    return remainingBins;
  }

  const [defaultBin, ...rest] = remainingBins;
  if (!defaultBin) {
    return remainingBins;
  }

  return [{ ...defaultBin, items: [...targetBin.items, ...defaultBin.items] }, ...rest];
}

export function setSourceBinCollapsed(bins: SourceBin[], id: string, collapsed: boolean): SourceBin[] {
  return bins.map((bin) => (bin.id === id ? { ...bin, collapsed } : bin));
}

export function getAllSourceBinItems(bins: SourceBin[]): SourceBinLibraryItem[] {
  return bins.reduce<SourceBinLibraryItem[]>((items, bin) => [...items, ...(Array.isArray(bin.items) ? bin.items : [])], []);
}
