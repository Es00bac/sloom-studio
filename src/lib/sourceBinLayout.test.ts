import { describe, expect, it } from 'vitest';
import {
  buildSourceLibraryDisplayRows,
  buildSourceBinKindCounts,
  buildSourceBinOriginCounts,
  filterSourceBinsForDisplay,
  filterSourceBinItemsForDisplay,
  getSourceLibraryDisplayRowHeight,
  groupSourceLibraryItems,
  resolveSourceBinSidebarPresentation,
  resolveSourceBinItemOrigin,
  sortSourceBinItemsForDisplay,
} from './sourceBinLayout';

describe('source bin display ordering', () => {
  it('pins starred items above unstarred items while preserving newest-first order inside each group', () => {
    const items = [
      { id: 'old-unstarred', label: 'Old', kind: 'video', createdAt: 1 },
      { id: 'new-unstarred', label: 'New', kind: 'video', createdAt: 10 },
      { id: 'old-starred', label: 'Pinned Old', kind: 'video', createdAt: 2, starred: true },
      { id: 'new-starred', label: 'Pinned New', kind: 'video', createdAt: 20, starred: true },
    ];

    expect(sortSourceBinItemsForDisplay(items).map((item) => item.id)).toEqual([
      'new-starred',
      'old-starred',
      'new-unstarred',
      'old-unstarred',
    ]);
  });

  it('filters large source bins by media kind and text query without losing display ordering', () => {
    const items = [
      { id: 'voice', label: 'Narration take', kind: 'audio', createdAt: 4 },
      { id: 'panel', label: 'Comic panel closeup', kind: 'image', createdAt: 9, starred: true },
      { id: 'wide', label: 'Comic panel wide render', kind: 'video', createdAt: 7 },
      { id: 'notes', label: 'Scene notes', kind: 'text', createdAt: 12, starred: true },
    ];

    expect(filterSourceBinItemsForDisplay(items, { kind: 'all', query: 'comic' }).map((item) => item.id)).toEqual([
      'panel',
      'wide',
    ]);
    expect(filterSourceBinItemsForDisplay(items, { kind: 'visual', query: '' }).map((item) => item.id)).toEqual([
      'notes',
      'panel',
      'wide',
    ]);
  });

  it('filters source bins by renamed item labels while preserving bin grouping', () => {
    const bins = [
      {
        id: 'pages',
        name: 'Pages',
        collapsed: false,
        createdAt: 1,
        items: [
          { id: 'cover', label: 'Renamed cover art', kind: 'image', createdAt: 3 },
          { id: 'page-2', label: 'Interior panel', kind: 'image', createdAt: 2 },
        ],
      },
      {
        id: 'audio',
        name: 'Audio',
        collapsed: false,
        createdAt: 1,
        items: [
          { id: 'voice', label: 'Narration', kind: 'audio', createdAt: 4 },
        ],
      },
    ];

    const filtered = filterSourceBinsForDisplay(bins, { kind: 'all', query: 'cover' });

    expect(filtered).toEqual([
      expect.objectContaining({
        id: 'pages',
        items: [expect.objectContaining({ id: 'cover' })],
      }),
    ]);
  });

  it('keeps empty bins visible so newly created bins can be renamed or imported into', () => {
    const bins = [
      {
        id: 'empty',
        name: 'Storyboard Refs',
        collapsed: false,
        createdAt: 1,
        items: [],
      },
      {
        id: 'audio',
        name: 'Audio',
        collapsed: false,
        createdAt: 1,
        items: [
          { id: 'voice', label: 'Narration', kind: 'audio', createdAt: 4 },
        ],
      },
    ];

    expect(filterSourceBinsForDisplay(bins, { kind: 'all', query: '' }).map((bin) => bin.id)).toEqual([
      'empty',
      'audio',
    ]);
    expect(filterSourceBinsForDisplay(bins, { kind: 'all', query: 'storyboard' })).toEqual([
      expect.objectContaining({ id: 'empty', items: [] }),
    ]);
  });

  it('summarizes source-bin kinds for compact filter chips', () => {
    const counts = buildSourceBinKindCounts([
      { id: 'image-1', label: 'Frame', kind: 'image' },
      { id: 'video-1', label: 'Clip', kind: 'video' },
      { id: 'video-2', label: 'Render', kind: 'composition' },
      { id: 'audio-1', label: 'VO', kind: 'audio' },
      { id: 'text-1', label: 'Caption', kind: 'text' },
      { id: 'subtitle-1', label: 'Captions.vtt', kind: 'subtitle' },
    ]);

    expect(counts).toEqual({
      all: 6,
      visual: 4,
      video: 2,
      image: 1,
      audio: 1,
      text: 1,
      subtitle: 1,
    });
  });

  it('separates ingested originals from generated assets without guessing from filenames', () => {
    const items = [
      { id: 'camera', label: 'A001 generated-looking-name.mov', kind: 'video', isGenerated: false },
      { id: 'legacy-import', label: 'Legacy import.mp4', kind: 'video' },
      { id: 'ai', label: 'Studio output', kind: 'video', isGenerated: true },
    ];

    expect(buildSourceBinOriginCounts(items)).toEqual({ all: 3, ingested: 2, generated: 1 });
    expect(resolveSourceBinItemOrigin(items[0])).toBe('ingested');
    expect(resolveSourceBinItemOrigin(items[1])).toBe('ingested');
    expect(resolveSourceBinItemOrigin(items[2])).toBe('generated');
    expect(filterSourceBinItemsForDisplay(items, { kind: 'all', origin: 'ingested', query: '' })
      .map((item) => item.id)).toEqual(['camera', 'legacy-import']);
    expect(filterSourceBinItemsForDisplay(items, { kind: 'all', origin: 'generated', query: '' })
      .map((item) => item.id)).toEqual(['ai']);
  });

  it('keeps dockable source-bin content expanded and routes the rail toggle to dock collapse', () => {
    expect(resolveSourceBinSidebarPresentation({ dockable: true, sidebarOpen: false })).toEqual({
      contentOpen: true,
      widthClassName: 'w-full',
      toggleAction: 'collapse-dock',
    });
    expect(resolveSourceBinSidebarPresentation({ dockable: false, sidebarOpen: false })).toEqual({
      contentOpen: false,
      widthClassName: 'w-14',
      toggleAction: 'toggle-sidebar',
    });
  });

  it('keeps embedded mobile drawer source-bin content expanded without its own collapse rail', () => {
    expect(resolveSourceBinSidebarPresentation({ dockable: true, embeddedDrawer: true, sidebarOpen: false })).toEqual({
      contentOpen: true,
      widthClassName: 'w-full',
      toggleAction: 'none',
    });
  });

  it('groups source-bin envelope children and exposes the persisted group collapsed state', () => {
    const grouped = groupSourceLibraryItems([
      { id: 'solo', label: 'Loose asset', kind: 'image', createdAt: 4 },
      {
        id: 'env-b',
        label: 'Frame B',
        kind: 'image',
        createdAt: 3,
        envelopeId: 'env-1',
        envelopeLabel: 'Batch images',
        envelopeCollapsed: true,
      },
      {
        id: 'env-a',
        label: 'Frame A',
        kind: 'image',
        createdAt: 2,
        envelopeId: 'env-1',
        envelopeLabel: 'Batch images',
        envelopeCollapsed: true,
      },
    ]);

    expect(grouped).toEqual([
      expect.objectContaining({
        kind: 'envelope',
        id: 'env-1',
        label: 'Batch images',
        collapsed: true,
        items: [
          expect.objectContaining({ id: 'env-b' }),
          expect.objectContaining({ id: 'env-a' }),
        ],
      }),
      expect.objectContaining({ kind: 'item', item: expect.objectContaining({ id: 'solo' }) }),
    ]);
  });

  it('flattens source-bin envelope groups into virtualizable header and child rows', () => {
    const rows = buildSourceLibraryDisplayRows([
      { id: 'solo', label: 'Loose asset', kind: 'image', createdAt: 4 },
      {
        id: 'env-b',
        label: 'Frame B',
        kind: 'image',
        createdAt: 3,
        envelopeId: 'env-1',
        envelopeLabel: 'Batch images',
        envelopeCollapsed: false,
      },
      {
        id: 'env-a',
        label: 'Frame A',
        kind: 'image',
        createdAt: 2,
        envelopeId: 'env-1',
        envelopeLabel: 'Batch images',
        envelopeCollapsed: false,
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'envelope-header',
        id: 'env-1',
        itemCount: 2,
        collapsed: false,
      }),
      expect.objectContaining({
        kind: 'envelope-item',
        envelopeId: 'env-1',
        item: expect.objectContaining({ id: 'env-b' }),
      }),
      expect.objectContaining({
        kind: 'envelope-item',
        envelopeId: 'env-1',
        item: expect.objectContaining({ id: 'env-a' }),
      }),
      expect.objectContaining({
        kind: 'item',
        item: expect.objectContaining({ id: 'solo' }),
      }),
    ]);
  });

  it('omits collapsed envelope child rows and reports row heights for virtualization', () => {
    const collapsedRows = buildSourceLibraryDisplayRows([
      {
        id: 'env-a',
        label: 'Frame A',
        kind: 'image',
        createdAt: 2,
        envelopeId: 'env-1',
        envelopeLabel: 'Batch images',
        envelopeCollapsed: true,
        collapsed: true,
      },
      { id: 'solo', label: 'Loose asset', kind: 'image', createdAt: 4, collapsed: false },
    ]);

    expect(collapsedRows).toEqual([
      expect.objectContaining({
        kind: 'envelope-header',
        id: 'env-1',
        collapsed: true,
      }),
      expect.objectContaining({
        kind: 'item',
        item: expect.objectContaining({ id: 'solo' }),
      }),
    ]);

    expect(getSourceLibraryDisplayRowHeight(collapsedRows[0]!)).toBeGreaterThan(0);
    expect(getSourceLibraryDisplayRowHeight(collapsedRows[1]!)).toBeGreaterThan(
      getSourceLibraryDisplayRowHeight(collapsedRows[0]!),
    );
  });
});
