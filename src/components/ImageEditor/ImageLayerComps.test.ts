import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import { applyImageLayerComp, captureImageLayerComp, deleteImageLayerComp, renameImageLayerComp, upsertImageLayerComp } from './ImageLayerComps';

function layer(id: string, visible = true): ImageLayer {
  return { id, name: id, type: 'image', visible, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null };
}

function documentFixture(): ImageDocument {
  return { id: 'doc', title: 'Layer comps', width: 16, height: 16, layers: [layer('base'), { ...layer('grade', false), opacity: 0.4, blendMode: 'screen' }], activeLayerId: 'grade', hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false };
}

describe('ImageLayerComps', () => {
  it('captures and reapplies visibility, opacity, and blend mode without replacing pixels or transforms', () => {
    const source = documentFixture();
    const comp = captureImageLayerComp(source, 'Night grade');
    const changed = [{ ...source.layers[0], visible: false, x: 22 }, { ...source.layers[1], visible: true, opacity: 1, blendMode: 'normal' as const }];
    const restored = applyImageLayerComp(changed, comp);
    expect(restored).toMatchObject([{ id: 'base', visible: true, x: 22 }, { id: 'grade', visible: false, opacity: 0.4, blendMode: 'screen' }]);
  });

  it('replaces a same-named comp instead of accumulating ambiguous applies', () => {
    const document = documentFixture();
    const first = captureImageLayerComp(document, 'Delivery');
    const second = captureImageLayerComp({ ...document, layers: document.layers.map((entry) => ({ ...entry, visible: false })) }, 'Delivery');
    expect(upsertImageLayerComp([first], second)).toEqual([second]);
  });
});

describe('MH-051 repair: Layer Comp rename and delete', () => {
  function compsFixture() {
    const document = documentFixture();
    const night = { ...captureImageLayerComp(document, 'Night inks'), id: 'comp-night' };
    const day = { ...captureImageLayerComp({ ...document, layers: document.layers.map((entry) => ({ ...entry, visible: false })) }, 'Day proofs'), id: 'comp-day' };
    return { document, list: [night, day] };
  }

  it('renames a comp in place and keeps every recorded layer state', () => {
    const { list } = compsFixture();
    const result = renameImageLayerComp(list, 'comp-night', 'Dusk inks');
    expect(result).toMatchObject({ ok: true, comps: [{ id: 'comp-night', name: 'Dusk inks' }, { id: 'comp-day', name: 'Day proofs' }] });
  });

  it('refuses blank, colliding, and unknown renames without corrupting the comp list', () => {
    const { list } = compsFixture();
    expect(renameImageLayerComp(list, 'comp-night', '   ')).toMatchObject({ ok: false, reason: 'blank-name' });
    expect(renameImageLayerComp(list, 'comp-night', 'Day proofs')).toMatchObject({ ok: false, reason: 'duplicate-name' });
    expect(renameImageLayerComp(list, 'comp-gone', 'Whatever')).toMatchObject({ ok: false, reason: 'unknown-comp' });
    expect(renameImageLayerComp(undefined, 'comp-gone', 'Whatever')).toMatchObject({ ok: false, reason: 'unknown-comp' });
    // Every refusal leaves the retained list byte-identical.
    expect(list.map((comp) => comp.name)).toEqual(['Night inks', 'Day proofs']);
  });

  it('allows renaming a comp to its own trimmed name and trims long names like capture does', () => {
    const { list } = compsFixture();
    expect(renameImageLayerComp(list, 'comp-day', '  Day proofs  ')).toMatchObject({
      ok: true,
      comps: [{ id: 'comp-night', name: 'Night inks' }, { id: 'comp-day', name: 'Day proofs' }],
    });
    const long = `  ${'x'.repeat(120)}  `;
    const trimmed = renameImageLayerComp(list, 'comp-day', long);
    expect(trimmed).toMatchObject({ ok: true });
    if (trimmed.ok) expect(trimmed.comps[1]?.name).toHaveLength(80);
  });

  it('deletes a comp by id and refuses unknown ids without touching the rest of the list', () => {
    const { list } = compsFixture();
    const deleted = deleteImageLayerComp(list, 'comp-night');
    expect(deleted).toMatchObject({ ok: true, comps: [{ id: 'comp-day', name: 'Day proofs' }] });
    expect(deleteImageLayerComp(list, 'comp-gone')).toMatchObject({ ok: false, reason: 'unknown-comp' });
    expect(deleteImageLayerComp(undefined, 'comp-gone')).toMatchObject({ ok: false, reason: 'unknown-comp' });
    expect(list).toHaveLength(2);
  });

  it('still applies a renamed comp by its unchanged identity and saved values', () => {
    const { document, list } = compsFixture();
    const renamed = renameImageLayerComp(list, 'comp-night', 'Final lock');
    if (!renamed.ok) throw new Error('rename should succeed');
    const changed = document.layers.map((entry) => ({ ...entry, visible: !entry.visible, opacity: entry.opacity === 1 ? 0.25 : 1 }));
    expect(applyImageLayerComp(changed, renamed.comps[0])).toMatchObject([
      { id: 'base', visible: true },
      { id: 'grade', visible: false, opacity: 0.4, blendMode: 'screen' },
    ]);
  });
});
