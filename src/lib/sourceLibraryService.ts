import type { EditorSourceKind } from '../types/flow';
import type { SourceBin, SourceBinLibraryItem, SourceBinProjectSnapshot } from '../store/sourceBinStore';

export type SourceLibraryServiceChange =
  | { type: 'added'; version: number; item: SourceBinLibraryItem; binId: string }
  | { type: 'renamed'; version: number; itemId: string; label: string }
  | { type: 'removed'; version: number; item: SourceBinLibraryItem; binId: string };

type SourceLibraryServiceChangeInput =
  | Omit<Extract<SourceLibraryServiceChange, { type: 'added' }>, 'version'>
  | Omit<Extract<SourceLibraryServiceChange, { type: 'renamed' }>, 'version'>
  | Omit<Extract<SourceLibraryServiceChange, { type: 'removed' }>, 'version'>;

export interface SourceLibraryListRequest {
  query?: string;
  kind?: EditorSourceKind | 'all';
  offset?: number;
  limit?: number;
}

export interface SourceLibraryListResult {
  items: SourceBinLibraryItem[];
  total: number;
  version: number;
}

export interface SourceLibraryService {
  getVersion: () => number;
  getSnapshot: () => SourceBinProjectSnapshot;
  list: (request?: SourceLibraryListRequest) => SourceLibraryListResult;
  get: (id: string) => SourceBinLibraryItem | undefined;
  add: (item: SourceBinLibraryItem, binId?: string) => SourceBinLibraryItem;
  rename: (id: string, label: string) => SourceBinLibraryItem | undefined;
  remove: (id: string) => SourceBinLibraryItem | undefined;
  resolveUrl: (id: string) => string | undefined;
  subscribe: (listener: (change: SourceLibraryServiceChange) => void) => () => void;
}

export function createInMemorySourceLibraryService(
  snapshot?: SourceBinProjectSnapshot,
): SourceLibraryService {
  let version = 0;
  let bins = createInitialBins(snapshot);
  const listeners = new Set<(change: SourceLibraryServiceChange) => void>();

  const emit = (change: SourceLibraryServiceChangeInput) => {
    version += 1;
    const versionedChange = { ...change, version } as SourceLibraryServiceChange;
    listeners.forEach((listener) => listener(versionedChange));
  };

  const getAllItems = () => bins.flatMap((bin) => bin.items);

  return {
    getVersion: () => version,
    getSnapshot: () => ({
      bins: bins.map((bin) => ({ ...bin, items: bin.items.map((item) => ({ ...item })) })),
      dismissedSourceKeys: snapshot?.dismissedSourceKeys ? [...snapshot.dismissedSourceKeys] : [],
    }),
    list: (request = {}) => {
      const normalizedQuery = request.query?.trim().toLocaleLowerCase() ?? '';
      const offset = Math.max(0, Math.floor(request.offset ?? 0));
      const limit = request.limit === undefined ? undefined : Math.max(0, Math.floor(request.limit));
      const filtered = getAllItems().filter((item) => {
        if (request.kind && request.kind !== 'all' && item.kind !== request.kind) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return `${item.label} ${item.kind} ${item.mimeType ?? ''}`.toLocaleLowerCase().includes(normalizedQuery);
      });
      const items = limit === undefined ? filtered.slice(offset) : filtered.slice(offset, offset + limit);

      return {
        items: items.map((item) => ({ ...item })),
        total: filtered.length,
        version,
      };
    },
    get: (id) => {
      const item = getAllItems().find((candidate) => candidate.id === id);
      return item ? { ...item } : undefined;
    },
    add: (item, binId) => {
      const targetBinId = binId && bins.some((bin) => bin.id === binId) ? binId : bins[0]?.id ?? 'default';
      const nextItem = { ...item };
      bins = bins.map((bin, index) =>
        bin.id === targetBinId || (index === 0 && !bins.some((candidate) => candidate.id === targetBinId))
          ? { ...bin, items: [nextItem, ...bin.items.filter((candidate) => candidate.id !== nextItem.id)] }
          : { ...bin, items: bin.items.filter((candidate) => candidate.id !== nextItem.id) },
      );
      emit({ type: 'added', item: nextItem, binId: targetBinId });
      return { ...nextItem };
    },
    rename: (id, label) => {
      const normalizedLabel = label.trim();
      if (!normalizedLabel) {
        return undefined;
      }

      let renamedItem: SourceBinLibraryItem | undefined;
      bins = bins.map((bin) => ({
        ...bin,
        items: bin.items.map((item) => {
          if (item.id !== id || item.label === normalizedLabel) {
            return item;
          }

          renamedItem = { ...item, label: normalizedLabel };
          return renamedItem;
        }),
      }));

      if (!renamedItem) {
        return undefined;
      }

      emit({ type: 'renamed', itemId: id, label: normalizedLabel });
      return { ...renamedItem };
    },
    remove: (id) => {
      let removedItem: SourceBinLibraryItem | undefined;
      let removedBinId = '';
      bins = bins.map((bin) => {
        const item = bin.items.find((candidate) => candidate.id === id);
        if (!item) {
          return bin;
        }

        removedItem = item;
        removedBinId = bin.id;
        return { ...bin, items: bin.items.filter((candidate) => candidate.id !== id) };
      });

      if (!removedItem) {
        return undefined;
      }

      emit({ type: 'removed', item: removedItem, binId: removedBinId });
      return { ...removedItem };
    },
    resolveUrl: (id) => getAllItems().find((item) => item.id === id)?.assetUrl,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createInitialBins(snapshot: SourceBinProjectSnapshot | undefined): SourceBin[] {
  if (snapshot?.bins?.length) {
    return snapshot.bins.map((bin) => ({ ...bin, items: bin.items.map((item) => ({ ...item })) }));
  }

  if (snapshot?.items?.length) {
    return [{
      id: 'default',
      name: 'Source Library',
      collapsed: false,
      createdAt: Date.now(),
      items: snapshot.items.map((item) => ({ ...item })),
    }];
  }

  return [{
    id: 'default',
    name: 'Source Library',
    collapsed: false,
    createdAt: Date.now(),
    items: [],
  }];
}
