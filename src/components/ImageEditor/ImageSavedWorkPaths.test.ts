import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import { DEFAULT_SHAPE_TOOL_SETTINGS } from '../../types/imageEditor';
import { buildVectorPathLayer } from './ImageVectorShape';
import {
  createSavedWorkPathFromLayer,
  getNextSavedWorkPathName,
  getSavedWorkPathBounds,
  getUniqueSavedWorkPathName,
  MAX_SAVED_WORK_PATHS,
  planSavedWorkPathToSelection,
  renameSavedWorkPath,
  sanitizeSavedWorkPathName,
  savedWorkPathToSelectionMask,
  truncateSavedWorkPaths,
} from './ImageSavedWorkPaths';

class FakeOffscreenCanvasContext {
  beginPath() {}
  rect() {}
  ellipse() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  closePath() {}
  fill() {}
  stroke() {}
  clearRect() {}
  drawImage() {}
  save() {}
  restore() {}
  getImageData(_x: number, _y: number, width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context = new FakeOffscreenCanvasContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function buildClosedTrianglePathLayer() {
  const doc = createEmptyImageDocument({ id: 'doc-saved-path', title: 'Saved Path', width: 200, height: 160 });
  const layer = {
    ...buildVectorPathLayer({
      doc,
      points: [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 50, y: 80 },
      ],
      closed: true,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    }),
    id: 'layer-triangle',
    name: 'Ink Triangle',
  };
  return { doc, layer };
}

describe('ImageSavedWorkPaths', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detaches a copy of a vector path layer geometry, independent of the source layer', () => {
    const { layer } = buildClosedTrianglePathLayer();

    const saved = createSavedWorkPathFromLayer(layer, []);

    expect(saved).not.toBeNull();
    expect(saved!.kind).toBe('saved');
    expect(saved!.closed).toBe(true);
    expect(saved!.points).toEqual([
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 50, y: 80 },
    ]);
    expect(saved!.name).toBe('Ink Triangle');
    expect(saved!.id).not.toBe(layer.id);
  });

  it('keeps the saved path unaffected when the source layer is later mutated or deleted', () => {
    const { layer } = buildClosedTrianglePathLayer();
    const saved = createSavedWorkPathFromLayer(layer, [])!;
    const savedPointsBeforeMutation = saved.points.map((point) => ({ ...point }));

    // Mutate the layer's own point array in place to simulate later editing of the source layer.
    layer.metadata!.vectorShape = {
      ...(layer.metadata!.vectorShape as any),
      points: [{ x: 999, y: 999 }],
    };

    expect(saved.points).toEqual(savedPointsBeforeMutation);
  });

  it('returns null when detaching a non-path or too-short shape', () => {
    const { doc } = buildClosedTrianglePathLayer();
    const rectLayer = {
      ...buildVectorPathLayer({
        doc,
        points: [{ x: 0, y: 0 }],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'layer-too-short',
      name: 'Too Short',
    };

    expect(createSavedWorkPathFromLayer(rectLayer, [])).toBeNull();
  });

  it('produces unique auto-incrementing names and preserves manual renames', () => {
    expect(getNextSavedWorkPathName([])).toBe('Path 1');
    const existing = [
      { id: 'a', name: 'Path 1', kind: 'saved' as const, closed: true, points: [], createdAt: 0, updatedAt: 0 },
    ];
    expect(getNextSavedWorkPathName(existing)).toBe('Path 2');
    expect(getUniqueSavedWorkPathName('Path 1', existing)).toBe('Path 1 2');

    const renamed = renameSavedWorkPath(existing[0]!, 'Ink Contour');
    expect(renamed.name).toBe('Ink Contour');
    expect(renamed.id).toBe(existing[0]!.id);
    expect(existing[0]!.name).toBe('Path 1');
  });

  it('rejects blank or overlong names', () => {
    expect(sanitizeSavedWorkPathName('   ')).toBeNull();
    expect(sanitizeSavedWorkPathName(42)).toBeNull();
    expect(sanitizeSavedWorkPathName('  Contour  ')).toBe('Contour');
  });

  it('computes a bounding box from the saved path points', () => {
    const bounds = getSavedWorkPathBounds({ points: [{ x: 10, y: 40 }, { x: 60, y: 5 }] });
    expect(bounds).toEqual({ x: 10, y: 5, width: 50, height: 35 });
    expect(getSavedWorkPathBounds({ points: [] })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('fills a closed 3+ point saved path into a selection mask, independent of any layer', () => {
    const { layer } = buildClosedTrianglePathLayer();
    const saved = createSavedWorkPathFromLayer(layer, [])!;

    const mask = savedWorkPathToSelectionMask(200, 160, saved);

    expect(mask).not.toBeNull();
    expect(mask!.width).toBe(200);
    expect(mask!.height).toBe(160);
    const selectedCount = mask!.data.reduce((total, value) => total + (value > 0 ? 1 : 0), 0);
    expect(selectedCount).toBeGreaterThan(0);
  });

  it('refuses to build a selection mask from a saved path with fewer than 3 points', () => {
    const twoPointPath = {
      id: 'p', name: 'Line', kind: 'saved' as const, closed: false,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], createdAt: 0, updatedAt: 0,
    };
    expect(savedWorkPathToSelectionMask(100, 100, twoPointPath)).toBeNull();
    const plan = planSavedWorkPathToSelection(twoPointPath);
    expect(plan.canApply).toBe(false);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('plans a ready make-selection action for a valid saved path', () => {
    const { layer } = buildClosedTrianglePathLayer();
    const saved = createSavedWorkPathFromLayer(layer, [])!;
    const plan = planSavedWorkPathToSelection(saved);
    expect(plan.canApply).toBe(true);
    expect(plan.pointCount).toBe(3);
    expect(plan.warnings).toEqual([]);
  });

  it('bounds the saved-path catalogue to the maximum size, keeping the most recent entries', () => {
    const many = Array.from({ length: MAX_SAVED_WORK_PATHS + 5 }, (_, index) => ({
      id: `p${index}`, name: `Path ${index}`, kind: 'saved' as const, closed: true,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], createdAt: index, updatedAt: index,
    }));
    const truncated = truncateSavedWorkPaths(many);
    expect(truncated.length).toBe(MAX_SAVED_WORK_PATHS);
    expect(truncated[0]!.id).toBe(`p${5}`);
    expect(truncated[truncated.length - 1]!.id).toBe(`p${MAX_SAVED_WORK_PATHS + 4}`);
  });
});
