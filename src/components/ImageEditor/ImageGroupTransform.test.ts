import { describe, expect, it } from 'vitest';
import type { ImageLayer } from '../../types/imageEditor';
import {
  resolveSelectedLayerIds,
  toggleLayerInSelection,
  rangeLayerSelection,
  getGroupBounds,
  translateSelectedLayers,
  rotateSelectedLayersAroundPivot,
} from './ImageGroupTransform';

function layer(id: string, x: number, y: number): ImageLayer {
  return {
    id, name: id, type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal',
    x, y, bitmap: null, bitmapVersion: 0, mask: null,
  } as ImageLayer;
}

describe('resolveSelectedLayerIds', () => {
  it('falls back to the active layer when no multi-selection', () => {
    const doc = { layers: [layer('a', 0, 0), layer('b', 0, 0)], activeLayerId: 'b', selectedLayerIds: undefined };
    expect(resolveSelectedLayerIds(doc)).toEqual(['b']);
  });
  it('returns the multi-selection, deduped and filtered to existing layers', () => {
    const doc = { layers: [layer('a', 0, 0), layer('b', 0, 0)], activeLayerId: 'a', selectedLayerIds: ['a', 'b', 'a', 'ghost'] };
    expect(resolveSelectedLayerIds(doc)).toEqual(['a', 'b']);
  });
});

describe('toggleLayerInSelection', () => {
  it('adds a layer and makes it active', () => {
    expect(toggleLayerInSelection(['a'], 'a', 'b')).toEqual({ selectedLayerIds: ['a', 'b'], activeLayerId: 'b' });
  });
  it('removes a layer and promotes a new active when removing the active one', () => {
    expect(toggleLayerInSelection(['a', 'b'], 'b', 'b')).toEqual({ selectedLayerIds: ['a'], activeLayerId: 'a' });
  });
  it('never empties the selection', () => {
    expect(toggleLayerInSelection(['a'], 'a', 'a')).toEqual({ selectedLayerIds: ['a'], activeLayerId: 'a' });
  });
});

describe('rangeLayerSelection', () => {
  it('selects the inclusive contiguous range regardless of direction', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(rangeLayerSelection(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeLayerSelection(order, 'a', 'c')).toEqual(['a', 'b', 'c']);
  });
});

describe('getGroupBounds', () => {
  it('unions the selected layer rects', () => {
    const rects = [
      { id: 'a', x: 10, y: 10, width: 20, height: 20 },
      { id: 'b', x: 50, y: 40, width: 30, height: 10 },
      { id: 'c', x: 0, y: 0, width: 5, height: 5 },
    ];
    expect(getGroupBounds(rects, ['a', 'b'])).toEqual({ x: 10, y: 10, width: 70, height: 40 });
  });
  it('returns null with no selection', () => {
    expect(getGroupBounds([{ id: 'a', x: 0, y: 0, width: 1, height: 1 }], [])).toBeNull();
  });
});

describe('translateSelectedLayers', () => {
  it('shifts only the selected layers', () => {
    const layers = [layer('a', 0, 0), layer('b', 100, 100)];
    const moved = translateSelectedLayers(layers, ['b'], 10, -5);
    expect(moved[0]).toEqual(layers[0]); // a unchanged (same ref)
    expect({ x: moved[1].x, y: moved[1].y }).toEqual({ x: 110, y: 95 });
  });
});

describe('rotateSelectedLayersAroundPivot', () => {
  it('orbits positions about the pivot and adds to each rotation', () => {
    const layers = [layer('a', 100, 100)]; // centre (150,150) for a 100x100 layer
    const sizeOf = () => ({ width: 100, height: 100 });
    const r = rotateSelectedLayersAroundPivot(layers, ['a'], { x: 150, y: 150 }, 90, sizeOf);
    // centre is at the pivot, so position is unchanged; rotation is applied.
    expect(r[0].x).toBeCloseTo(100, 5);
    expect(r[0].y).toBeCloseTo(100, 5);
    expect(r[0].rotationDeg).toBe(90);

    // A layer offset from the pivot orbits 90deg clockwise (screen Y down).
    const offset = [layer('b', 250, 100)]; // centre (300,150), pivot (150,150) -> offset (150,0)
    const r2 = rotateSelectedLayersAroundPivot(offset, ['b'], { x: 150, y: 150 }, 90, sizeOf);
    // (150,0) rotated +90 (Y-down) -> (0,150); new centre (150,300) -> top-left (100,250)
    expect(r2[0].x).toBeCloseTo(100, 4);
    expect(r2[0].y).toBeCloseTo(250, 4);
  });
});
