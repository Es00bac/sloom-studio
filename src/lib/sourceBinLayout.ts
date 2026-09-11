import type { MediaPreviewKind } from './mediaPreview';

export interface SourceBinDisplayItem {
  id: string;
  label: string;
  kind: string;
  createdAt?: number;
  starred?: boolean;
  assetUrl?: string;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeCollapsed?: boolean;
  /** True for assets created by Sloom/Flow; false or absent means user-ingested media. */
  isGenerated?: boolean;
  professional?: { origin?: 'imported' | 'generated' };
}

export type SourceBinKindFilter = 'all' | 'visual' | 'video' | 'image' | 'audio' | 'text' | 'subtitle';
export type SourceBinOrigin = 'ingested' | 'generated';
export type SourceBinOriginFilter = 'all' | SourceBinOrigin;

export interface SourceBinDisplayFilter {
  kind: SourceBinKindFilter;
  query: string;
  origin?: SourceBinOriginFilter;
}

export interface SourceBinDisplayBin<T extends SourceBinDisplayItem> {
  id: string;
  name: string;
  items: T[];
}

export interface SourceBinKindCounts {
  all: number;
  visual: number;
  video: number;
  image: number;
  audio: number;
  text: number;
  subtitle: number;
}

export interface SourceBinOriginCounts {
  all: number;
  ingested: number;
  generated: number;
}

export type SourceLibraryDisplayEntry<T extends SourceBinDisplayItem> =
  | { kind: 'item'; item: T }
  | { kind: 'envelope'; id: string; label: string; collapsed: boolean; items: T[] };

export type SourceLibraryDisplayRow<T extends SourceBinDisplayItem> =
  | { kind: 'item'; key: string; item: T }
  | { kind: 'envelope-header'; key: string; id: string; label: string; collapsed: boolean; itemCount: number; items: T[] }
  | { kind: 'envelope-item'; key: string; envelopeId: string; item: T };

export interface SourceBinSidebarPresentationInput {
  dockable: boolean;
  embeddedDrawer?: boolean;
  sidebarOpen: boolean;
}

export interface SourceBinSidebarPresentation {
  contentOpen: boolean;
  widthClassName: 'w-full' | 'w-[22rem]' | 'w-14';
  toggleAction: 'collapse-dock' | 'toggle-sidebar' | 'none';
}

export function resolveSourceBinSidebarPresentation(
  input: SourceBinSidebarPresentationInput,
): SourceBinSidebarPresentation {
  if (input.embeddedDrawer) {
    return {
      contentOpen: true,
      widthClassName: 'w-full',
      toggleAction: 'none',
    };
  }

  if (input.dockable) {
    return {
      contentOpen: true,
      widthClassName: 'w-full',
      toggleAction: 'collapse-dock',
    };
  }

  return {
    contentOpen: input.sidebarOpen,
    widthClassName: input.sidebarOpen ? 'w-[22rem]' : 'w-14',
    toggleAction: 'toggle-sidebar',
  };
}

export function sortSourceBinItemsForDisplay<T extends SourceBinDisplayItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const starredDelta = Number(Boolean(right.starred)) - Number(Boolean(left.starred));

    if (starredDelta !== 0) {
      return starredDelta;
    }

    const createdDelta = (right.createdAt ?? 0) - (left.createdAt ?? 0);

    if (createdDelta !== 0) {
      return createdDelta;
    }

    return left.label.localeCompare(right.label);
  });
}

export function filterSourceBinItemsForDisplay<T extends SourceBinDisplayItem>(
  items: readonly T[],
  filter: SourceBinDisplayFilter,
): T[] {
  const normalizedQuery = filter.query.trim().toLocaleLowerCase();
  return sortSourceBinItemsForDisplay(
    items.filter((item) => {
      if (!matchesOriginFilter(item, filter.origin ?? 'all')) {
        return false;
      }

      if (!matchesKindFilter(item, filter.kind)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return `${item.label} ${item.kind} ${resolveSourceBinItemOrigin(item)}`.toLocaleLowerCase().includes(normalizedQuery);
    }),
  );
}

export function filterSourceBinsForDisplay<T extends SourceBinDisplayItem, B extends SourceBinDisplayBin<T>>(
  bins: readonly B[],
  filter: SourceBinDisplayFilter,
): B[] {
  const normalizedQuery = filter.query.trim().toLocaleLowerCase();

  return bins.flatMap((bin) => {
    const binNameMatches = Boolean(normalizedQuery) && bin.name.toLocaleLowerCase().includes(normalizedQuery);
    const items = binNameMatches
      ? filterSourceBinItemsForDisplay(bin.items, { ...filter, query: '' })
      : filterSourceBinItemsForDisplay(bin.items, filter);

    if (items.length > 0) {
      return [{ ...bin, items }];
    }

    if (!normalizedQuery || binNameMatches) {
      return [{ ...bin, items }];
    }

    return [];
  });
}

export function buildSourceBinKindCounts(items: readonly SourceBinDisplayItem[]): SourceBinKindCounts {
  const counts: SourceBinKindCounts = {
    all: items.length,
    visual: 0,
    video: 0,
    image: 0,
    audio: 0,
    text: 0,
    subtitle: 0,
  };

  for (const item of items) {
    if (matchesKindFilter(item, 'visual')) counts.visual += 1;
    if (matchesKindFilter(item, 'video')) counts.video += 1;
    if (matchesKindFilter(item, 'image')) counts.image += 1;
    if (matchesKindFilter(item, 'audio')) counts.audio += 1;
    if (matchesKindFilter(item, 'text')) counts.text += 1;
    if (matchesKindFilter(item, 'subtitle')) counts.subtitle += 1;
  }

  return counts;
}

/**
 * Legacy projects predate an explicit imported/generated switch. Their generated assets already
 * carry `isGenerated: true`, so treating every other item as ingested is both backwards compatible
 * and conservative: camera originals never drift into the Generated view because of a filename.
 */
export function resolveSourceBinItemOrigin(item: Pick<SourceBinDisplayItem, 'isGenerated' | 'professional'>): SourceBinOrigin {
  if (item.professional?.origin) {
    return item.professional.origin === 'generated' ? 'generated' : 'ingested';
  }
  return item.isGenerated === true ? 'generated' : 'ingested';
}

export function matchesOriginFilter(
  item: Pick<SourceBinDisplayItem, 'isGenerated' | 'professional'>,
  origin: SourceBinOriginFilter,
): boolean {
  return origin === 'all' || resolveSourceBinItemOrigin(item) === origin;
}

export function buildSourceBinOriginCounts(items: readonly SourceBinDisplayItem[]): SourceBinOriginCounts {
  let generated = 0;

  for (const item of items) {
    if (resolveSourceBinItemOrigin(item) === 'generated') generated += 1;
  }

  return {
    all: items.length,
    ingested: items.length - generated,
    generated,
  };
}

export function getSourceBinPreviewKind(item: Pick<SourceBinDisplayItem, 'kind' | 'assetUrl'>): MediaPreviewKind | undefined {
  if (!item.assetUrl) {
    return undefined;
  }

  if (item.kind === 'image') {
    return 'image';
  }

  if (item.kind === 'video' || item.kind === 'composition') {
    return 'video';
  }

  return undefined;
}

export function groupSourceLibraryItems<T extends SourceBinDisplayItem>(
  items: readonly T[],
): SourceLibraryDisplayEntry<T>[] {
  const looseEntries: Array<SourceLibraryDisplayEntry<T>> = [];
  const envelopeGroups = new Map<string, { label: string; items: T[] }>();
  const envelopeOrder: string[] = [];

  for (const item of items) {
    if (!item.envelopeId) {
      looseEntries.push({ kind: 'item', item });
      continue;
    }

    const group = envelopeGroups.get(item.envelopeId);
    if (group) {
      group.items.push(item);
      continue;
    }

    envelopeOrder.push(item.envelopeId);
    envelopeGroups.set(item.envelopeId, {
      label: item.envelopeLabel ?? 'Envelope',
      items: [item],
    });
  }

  return [
    ...envelopeOrder.map((id) => {
      const group = envelopeGroups.get(id);
      const items = group?.items ?? [];
      return {
        kind: 'envelope' as const,
        id,
        label: group?.label ?? 'Envelope',
        collapsed: items.some((item) => Boolean(item.envelopeCollapsed)),
        items: sortSourceBinItemsForDisplay(items),
      };
    }),
    ...looseEntries,
  ];
}

export function buildSourceLibraryDisplayRows<T extends SourceBinDisplayItem>(
  items: readonly T[],
): SourceLibraryDisplayRow<T>[] {
  const rows: SourceLibraryDisplayRow<T>[] = [];

  for (const entry of groupSourceLibraryItems(items)) {
    if (entry.kind === 'item') {
      rows.push({
        kind: 'item' as const,
        key: `item:${entry.item.id}`,
        item: entry.item,
      });
      continue;
    }

    rows.push({
      kind: 'envelope-header' as const,
      key: `envelope:${entry.id}`,
      id: entry.id,
      label: entry.label,
      collapsed: entry.collapsed,
      itemCount: entry.items.length,
      items: entry.items,
    });

    if (!entry.collapsed) {
      for (const item of entry.items) {
        rows.push({
          kind: 'envelope-item' as const,
          key: `envelope-item:${item.id}`,
          envelopeId: entry.id,
          item,
        });
      }
    }
  }

  return rows;
}

export function getSourceLibraryDisplayRowHeight<T extends SourceBinDisplayItem & { collapsed?: boolean }>(
  row: SourceLibraryDisplayRow<T>,
): number {
  if (row.kind === 'envelope-header') {
    return 52;
  }

  return row.item.collapsed ? 76 : 124;
}

function matchesKindFilter(item: SourceBinDisplayItem, filter: SourceBinKindFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'visual':
      return item.kind === 'image' || item.kind === 'video' || item.kind === 'composition' || item.kind === 'text';
    case 'video':
      return item.kind === 'video' || item.kind === 'composition';
    case 'image':
      return item.kind === 'image';
    case 'audio':
      return item.kind === 'audio';
    case 'text':
      return item.kind === 'text';
    case 'subtitle':
      return item.kind === 'subtitle';
  }
}
