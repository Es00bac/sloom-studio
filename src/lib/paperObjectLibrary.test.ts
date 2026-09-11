import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import {
  createPaperObjectLibraryItem,
  materializePaperObjectLibraryItem,
  normalizePaperObjectLibraryItems,
  removePaperObjectLibraryItem,
  searchPaperObjectLibrary,
  upsertPaperObjectLibraryItem,
  validatePaperObjectLibraryFrame,
} from './paperObjectLibrary';

function frame() {
  const document = createDefaultPaperDocument();
  return addFrameToPaperPage(document, document.pages[0].id, {
    kind: 'caption',
    xMm: 20,
    yMm: 30,
    widthMm: 80,
    heightMm: 25,
    text: 'A reusable caption',
    label: 'Caption source',
  }).document.pages[0].frames[0];
}

describe('Paper object library', () => {
  it('creates a detached, named reusable object from an eligible frame', () => {
    const source = frame();
    const item = createPaperObjectLibraryItem(source, {
      name: 'Chapter caption',
      description: 'A consistent chapter opener caption.',
      now: 100,
      id: 'caption-1',
    });
    expect(item).toMatchObject({ id: 'caption-1', name: 'Chapter caption', kind: 'caption', createdAt: 100 });
    expect(item?.frame).not.toBe(source);
    expect(item?.frame.text).toBe('A reusable caption');
  });

  it('refuses asset-bearing and unsupported frames instead of creating dangling references', () => {
    const source = frame();
    expect(validatePaperObjectLibraryFrame({ ...source, kind: 'image' })).toMatchObject({ ok: false });
    expect(validatePaperObjectLibraryFrame({ ...source, asset: { label: 'Asset', kind: 'image', locator: { kind: 'external', url: 'https://example.test/a.png' } } })).toMatchObject({ ok: false });
    expect(createPaperObjectLibraryItem({ ...source, kind: 'image' }, { name: 'Nope' })).toBeUndefined();
  });

  it('materializes with fresh placement and strips document-local identity', () => {
    const source = frame();
    const item = createPaperObjectLibraryItem(source, { name: 'Caption', id: 'caption-1' })!;
    const result = materializePaperObjectLibraryItem(item, { xMm: 12, yMm: 18, layerId: 'layer-2' });
    expect(result?.kind).toBe('caption');
    expect(result?.patch).toMatchObject({ xMm: 12, yMm: 18, layerId: 'layer-2', locked: false, inherited: false });
    expect(result?.patch.id).toBeUndefined();
    expect(result?.patch.parentPageId).toBeUndefined();
    expect(result?.patch.zIndex).toBeUndefined();
  });

  it('uses a small offset when placement is omitted', () => {
    const item = createPaperObjectLibraryItem(frame(), { name: 'Caption', id: 'caption-1' })!;
    expect(materializePaperObjectLibraryItem(item)?.patch).toMatchObject({ xMm: 24, yMm: 34 });
  });

  it('normalizes persisted records fail-closed and bounds the library', () => {
    const source = frame();
    const item = createPaperObjectLibraryItem(source, { name: 'Caption', id: 'caption-1', now: 3 })!;
    const records = normalizePaperObjectLibraryItems([
      item,
      { ...item, id: 'bad-time', createdAt: 'now', updatedAt: 1 },
      { ...item, id: 'bad-frame', frame: { ...source, kind: 'image' } },
      { ...item, id: 'caption-1', name: 'duplicate', updatedAt: 4 },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('caption-1');
  });

  it('keeps the newest update first and caps at 200 items', () => {
    const source = frame();
    const items = Array.from({ length: 205 }, (_, index) => createPaperObjectLibraryItem(source, {
      name: `Caption ${index}`,
      id: `caption-${index}`,
      now: index,
    })!);
    const normalized = normalizePaperObjectLibraryItems(items);
    expect(normalized).toHaveLength(200);
    expect(normalized[0].id).toBe('caption-204');
    expect(normalized.at(-1)?.id).toBe('caption-5');
  });

  it('upserts and removes without mutating caller arrays', () => {
    const source = frame();
    const first = createPaperObjectLibraryItem(source, { name: 'First', id: 'one', now: 1 })!;
    const replacement = createPaperObjectLibraryItem(source, { name: 'Updated', id: 'one', now: 2 })!;
    const original = [first];
    const updated = upsertPaperObjectLibraryItem(original, replacement);
    expect(original[0].name).toBe('First');
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('Updated');
    expect(removePaperObjectLibraryItem(updated, 'one')).toEqual([]);
  });

  it('searches names, descriptions, and object kinds', () => {
    const source = frame();
    const one = createPaperObjectLibraryItem(source, { name: 'Chapter opener', description: 'Editorial caption', id: 'one' })!;
    const two = createPaperObjectLibraryItem({ ...source, kind: 'shape' }, { name: 'Panel border', id: 'two' })!;
    expect(searchPaperObjectLibrary([one, two], 'editorial')).toHaveLength(1);
    expect(searchPaperObjectLibrary([one, two], 'shape')[0].id).toBe('two');
    expect(searchPaperObjectLibrary([one, two], 'missing')).toEqual([]);
  });
});
