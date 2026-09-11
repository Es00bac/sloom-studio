import { describe, expect, it, vi } from 'vitest';
import {
  createInMemorySourceLibraryService,
  type SourceLibraryServiceChange,
} from './sourceLibraryService';

describe('source library service', () => {
  it('lists source items with pagination and resolves asset URLs by id', () => {
    const service = createInMemorySourceLibraryService({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            { id: 'a', label: 'Alpha', kind: 'image', assetUrl: 'signal-loom-asset://a', createdAt: 3 },
            { id: 'b', label: 'Beta', kind: 'video', assetUrl: 'signal-loom-asset://b', createdAt: 2 },
            { id: 'c', label: 'Caption', kind: 'text', text: 'Words', createdAt: 1 },
          ],
        },
      ],
      dismissedSourceKeys: [],
    });

    expect(service.list({ offset: 1, limit: 1 })).toEqual({
      items: [{ id: 'b', label: 'Beta', kind: 'video', assetUrl: 'signal-loom-asset://b', createdAt: 2 }],
      total: 3,
      version: 0,
    });
    expect(service.resolveUrl('a')).toBe('signal-loom-asset://a');
  });

  it('emits versioned changes when items are added renamed and removed', () => {
    const service = createInMemorySourceLibraryService();
    const changes: SourceLibraryServiceChange[] = [];
    const unsubscribe = service.subscribe((change) => changes.push(change));

    service.add({ id: 'image-1', label: 'Image', kind: 'image', assetUrl: 'asset://image', createdAt: 10 });
    service.rename('image-1', 'Renamed image');
    const removed = service.remove('image-1');
    unsubscribe();
    service.add({ id: 'image-2', label: 'Ignored', kind: 'image', assetUrl: 'asset://ignored', createdAt: 11 });

    expect(removed?.label).toBe('Renamed image');
    expect(changes.map((change) => change.type)).toEqual(['added', 'renamed', 'removed']);
    expect(changes.map((change) => change.version)).toEqual([1, 2, 3]);
    expect(service.get('image-1')).toBeUndefined();
    expect(service.getVersion()).toBe(4);
  });

  it('does not emit a rename change when the label is blank or unchanged', () => {
    const service = createInMemorySourceLibraryService({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{ id: 'image-1', label: 'Image', kind: 'image', assetUrl: 'asset://image', createdAt: 1 }],
      }],
      dismissedSourceKeys: [],
    });
    const listener = vi.fn();
    service.subscribe(listener);

    expect(service.rename('image-1', '   ')).toBeUndefined();
    expect(service.rename('image-1', 'Image')).toBeUndefined();

    expect(listener).not.toHaveBeenCalled();
    expect(service.getVersion()).toBe(0);
  });
});
