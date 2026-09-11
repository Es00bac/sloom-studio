import { describe, expect, it, vi } from 'vitest';
import { openSourceLibraryImageDocument } from './sourceLibraryImageOpen';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { ImageDocument } from '../types/imageEditor';

const imageItem: SourceBinLibraryItem = {
  id: 'image-1',
  label: 'Panel 01.png',
  kind: 'image',
  mimeType: 'image/png',
  assetUrl: 'blob:image-1',
  createdAt: 1,
};

function doc(id: string): ImageDocument {
  return {
    id,
    title: 'Panel 01.png',
    width: 640,
    height: 480,
    sourceBinItemId: 'image-1',
    layers: [],
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

describe('sourceLibraryImageOpen', () => {
  it('opens a Source Library image document and raises the Image workspace window', async () => {
    const opened: ImageDocument[] = [];
    const openWorkspaceWindow = vi.fn();

    const result = await openSourceLibraryImageDocument({
      item: imageItem,
      createDocument: async () => doc('doc-image-1'),
      openDocument: (nextDoc) => opened.push(nextDoc),
      openWorkspaceWindow,
    });

    expect(result).toBe('opened');
    expect(opened.map((openedDoc) => openedDoc.id)).toEqual(['doc-image-1']);
    expect(openWorkspaceWindow).toHaveBeenCalledWith('image');
  });

  it('falls back to a linked shell when bitmap document loading fails', async () => {
    const opened: ImageDocument[] = [];
    const statuses: string[] = [];

    const result = await openSourceLibraryImageDocument({
      item: imageItem,
      createDocument: async () => {
        throw new Error('fetch failed');
      },
      createShell: () => doc('doc-shell'),
      openDocument: (nextDoc) => opened.push(nextDoc),
      onStatus: (message) => statuses.push(message),
    });

    expect(result).toBe('shell');
    expect(opened.map((openedDoc) => openedDoc.id)).toEqual(['doc-shell']);
    expect(statuses.at(-1)).toContain('bitmap load failed: fetch failed');
  });

  it('rejects non-image Source Library items', async () => {
    const opened: ImageDocument[] = [];

    const result = await openSourceLibraryImageDocument({
      item: { ...imageItem, kind: 'video' },
      openDocument: (nextDoc) => opened.push(nextDoc),
    });

    expect(result).toBe('unsupported');
    expect(opened).toHaveLength(0);
  });
});
