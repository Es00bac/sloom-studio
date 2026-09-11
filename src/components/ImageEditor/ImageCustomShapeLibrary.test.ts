import { describe, expect, it } from 'vitest';
import { deleteImageCustomShapeLibraryRecord, loadImageCustomShapeLibrary, saveImageCustomShapeLibraryRecord } from './ImageCustomShapeLibrary';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as unknown as Storage;
}

describe('ImageCustomShapeLibrary', () => {
  it('persists bounded editable preset records and deletes by stable record id', () => {
    const target = storage();
    const saved = saveImageCustomShapeLibraryRecord({ name: 'Badge', preset: { kind: 'star', polygonSides: 5, starInnerRadius: 0.4 }, fillColor: '#fff', fillOpacity: 1, strokeColor: '#000', strokeOpacity: 1, strokeWidth: 2 }, target);
    expect(loadImageCustomShapeLibrary(target)).toEqual(saved);
    expect(saved[0]).toMatchObject({ name: 'Badge', preset: { kind: 'star', polygonSides: 5, starInnerRadius: 0.4 } });
    expect(deleteImageCustomShapeLibraryRecord(saved[0].id, target)).toEqual([]);
  });

  it('drops poisoned persisted records before they can reach the mounted Apply route', () => {
    const target = storage();
    const valid = {
      id: 'shape-library-valid',
      name: 'Valid badge',
      preset: { kind: 'star', polygonSides: 5, starInnerRadius: 0.4 },
      fillColor: '#ffffff',
      fillOpacity: 1,
      strokeColor: '#000000',
      strokeOpacity: 1,
      strokeWidth: 2,
      createdAt: 10,
    };
    target.setItem('signal-loom:image-custom-shape-library:v1', JSON.stringify([
      { ...valid, id: 'poisoned-fill', fillColor: { value: '#ffffff' } },
      { ...valid, id: 'poisoned-opacity', fillOpacity: '1' },
      { ...valid, id: 'poisoned-preset', preset: { kind: 'unknown' } },
      valid,
    ]));

    expect(loadImageCustomShapeLibrary(target)).toEqual([valid]);
  });
});
