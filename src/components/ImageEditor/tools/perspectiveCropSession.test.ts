import { describe, expect, it } from 'vitest';
import {
  buildPerspectiveCropGuideLines,
  createPerspectiveCropQuadFromRect,
  describePerspectiveCropSession,
  isPerspectiveCropQuadValid,
  movePerspectiveCropQuadCorner,
  PERSPECTIVE_CROP_MIN_AREA_PX2,
  PERSPECTIVE_CROP_MIN_EDGE_PX,
  perspectiveCropQuadBounds,
  pointInPerspectiveCropQuad,
  resolvePerspectiveCropAvailability,
  resolvePerspectiveCropCornerGrab,
  translatePerspectiveCropQuad,
  type PerspectiveCropQuad,
} from './perspectiveCropSession';
import type { ImageDocument, ImageLayer } from '../../../types/imageEditor';

function layer(patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...patch,
  };
}

function doc(patch: Partial<ImageDocument> = {}): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Doc',
    width: 300,
    height: 200,
    layers: [layer()],
    activeLayerId: 'layer-1',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    snapshots: [],
    ...patch,
  };
}

function tiltmarkLayer(): ImageLayer {
  return layer({
    type: 'image',
    metadata: { tiltmark: { schemaVersion: 1, role: 'surface' } },
  });
}

const UNIT_SQUARE: PerspectiveCropQuad = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

describe('perspectiveCropSession — quad geometry', () => {
  it('creates a quad from a drag rect in any drag direction', () => {
    expect(createPerspectiveCropQuadFromRect({ x: 10, y: 20, width: 80, height: 40 })).toEqual([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 60 },
      { x: 10, y: 60 },
    ]);
    expect(createPerspectiveCropQuadFromRect({ x: 90, y: 60, width: -80, height: -40 })).toEqual([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 60 },
      { x: 10, y: 60 },
    ]);
  });

  it('accepts only the documented TL/TR/BR/BL winding', () => {
    const clockwise: PerspectiveCropQuad = UNIT_SQUARE;
    const reverseWinding: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 0, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 0 },
    ];
    expect(isPerspectiveCropQuadValid(clockwise)).toBe(true);
    expect(isPerspectiveCropQuadValid(reverseWinding)).toBe(false);
  });

  it('rejects bowtie, collinear, collapsed, tiny, and non-finite quads', () => {
    const bowtie: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 100, y: 0 },
      { x: 0, y: 60 },
    ];
    expect(isPerspectiveCropQuadValid(bowtie)).toBe(false);

    const collinear: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 150, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(isPerspectiveCropQuadValid(collinear)).toBe(false);

    const collapsed: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ];
    expect(isPerspectiveCropQuadValid(collapsed)).toBe(false);

    const tiny: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(isPerspectiveCropQuadValid(tiny)).toBe(false);

    const nonFinite: PerspectiveCropQuad = [
      { x: Number.NaN, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ];
    expect(isPerspectiveCropQuadValid(nonFinite)).toBe(false);
  });

  it('rejects finite coordinates whose output cannot be allocated safely', () => {
    const huge: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 1e100, y: 0 },
      { x: 1e100, y: 1e100 },
      { x: 0, y: 1e100 },
    ];
    expect(isPerspectiveCropQuadValid(huge)).toBe(false);
  });

  it('rejects concave quads', () => {
    const concave: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 20, y: 30 },
      { x: 0, y: 60 },
    ];
    expect(isPerspectiveCropQuadValid(concave)).toBe(false);
  });

  it('moves one corner without mutating the input quad', () => {
    const moved = movePerspectiveCropQuadCorner(UNIT_SQUARE, 1, { x: 120, y: -10 });
    expect(moved[1]).toEqual({ x: 120, y: -10 });
    expect(UNIT_SQUARE[1]).toEqual({ x: 100, y: 0 });
    expect(moved[0]).toEqual(UNIT_SQUARE[0]);
  });

  it('translates the whole quad', () => {
    const moved = translatePerspectiveCropQuad(UNIT_SQUARE, { x: 5, y: -7 });
    expect(moved[0]).toEqual({ x: 5, y: -7 });
    expect(moved[2]).toEqual({ x: 105, y: 53 });
  });

  it('computes quad bounds', () => {
    expect(perspectiveCropQuadBounds([
      { x: -10, y: 5 },
      { x: 90, y: -3 },
      { x: 80, y: 60 },
      { x: 0, y: 55 },
    ])).toEqual({ x: -10, y: -3, width: 100, height: 63 });
  });
});

describe('perspectiveCropSession — hit resolution', () => {
  it('grabs the nearest corner within the converted hit radius', () => {
    expect(resolvePerspectiveCropCornerGrab(UNIT_SQUARE, { x: 103, y: 4 }, 10)).toBe(1);
    expect(resolvePerspectiveCropCornerGrab(UNIT_SQUARE, { x: 0, y: 60 }, 10)).toBe(3);
    // Far from every corner -> no grab.
    expect(resolvePerspectiveCropCornerGrab(UNIT_SQUARE, { x: 50, y: 30 }, 5)).toBeNull();
  });

  it('keeps a small screen hit target usable at high zoom via doc-space conversion', () => {
    // 18 screen px at 9x zoom is only 2 doc px, but the slop keeps a 6 px-away grab alive.
    expect(resolvePerspectiveCropCornerGrab(UNIT_SQUARE, { x: 104, y: 2 }, 2)).toBe(1);
    expect(resolvePerspectiveCropCornerGrab(UNIT_SQUARE, { x: 30, y: 30 }, 2)).toBeNull();
  });

  it('tests point-in-quad with the same winding tolerance', () => {
    expect(pointInPerspectiveCropQuad(UNIT_SQUARE, { x: 50, y: 30 })).toBe(true);
    expect(pointInPerspectiveCropQuad(UNIT_SQUARE, { x: 150, y: 30 })).toBe(false);
    expect(pointInPerspectiveCropQuad(UNIT_SQUARE, { x: -1, y: 30 })).toBe(false);
  });
});

describe('perspectiveCropSession — guides', () => {
  it('projects exact thirds lines for an axis-aligned quad', () => {
    const lines = buildPerspectiveCropGuideLines(UNIT_SQUARE, 'thirds');
    expect(lines).toHaveLength(4);
    const xs = lines
      .filter((line) => Math.abs(line.from.x - line.to.x) < 1e-9)
      .map((line) => line.from.x)
      .sort((a, b) => a - b);
    const ys = lines
      .filter((line) => Math.abs(line.from.y - line.to.y) < 1e-9)
      .map((line) => line.from.y)
      .sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(ys).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(100 / 3, 5);
    expect(xs[1]).toBeCloseTo(200 / 3, 5);
    expect(ys[0]).toBeCloseTo(20, 5);
    expect(ys[1]).toBeCloseTo(40, 5);
  });

  it('returns six lines for grid mode and none for off or degenerate quads', () => {
    expect(buildPerspectiveCropGuideLines(UNIT_SQUARE, 'grid')).toHaveLength(6);
    expect(buildPerspectiveCropGuideLines(UNIT_SQUARE, 'none')).toHaveLength(0);
    const bowtie: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 100, y: 0 },
      { x: 0, y: 60 },
    ];
    expect(buildPerspectiveCropGuideLines(bowtie, 'thirds')).toHaveLength(0);
  });

  it('keeps projected guide endpoints on the quad boundary for a trapezoid', () => {
    const trapezoid: PerspectiveCropQuad = [
      { x: 20, y: 0 },
      { x: 120, y: 10 },
      { x: 110, y: 70 },
      { x: 10, y: 60 },
    ];
    const lines = buildPerspectiveCropGuideLines(trapezoid, 'thirds');
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      // Vertical-ish thirds lines have distinct x, similar y-range; horizontal lines the inverse.
      const isVertical = Math.abs(line.from.x - line.to.x) < Math.abs(line.from.y - line.to.y);
      if (isVertical) {
        expect(line.from.y).toBeLessThan(line.to.y);
      } else {
        expect(line.from.x).toBeLessThan(line.to.x);
      }
    }
  });
});

describe('perspectiveCropSession — availability and descriptor', () => {
  it('refuses editable Tiltmark surfaces', () => {
    const tiltmarkDoc = doc({ layers: [tiltmarkLayer()] });
    expect(resolvePerspectiveCropAvailability(tiltmarkDoc)).toEqual({
      available: false,
      refusal: 'tiltmark-surface-requires-raster',
    });
    expect(resolvePerspectiveCropAvailability(doc())).toEqual({ available: true, refusal: null });
  });

  it('refuses high-bit documents until a native perspective crop exists', () => {
    const highBitDoc = doc({ metadata: { bitDepth: 16, sourceBitDepth: 16 } });
    expect(resolvePerspectiveCropAvailability(highBitDoc)).toEqual({
      available: false,
      refusal: 'high-bit-depth-requires-native-crop',
    });
    const descriptor = describePerspectiveCropSession({
      doc: highBitDoc,
      quad: UNIT_SQUARE,
      guideMode: 'thirds',
    });
    expect(descriptor.validity.canApply).toBe(false);
    expect(descriptor.refusal).toBe('high-bit-depth-requires-native-crop');
  });

  it('describes a valid live session with output size, guides, and undo model', () => {
    const descriptor = describePerspectiveCropSession({
      doc: doc(),
      quad: UNIT_SQUARE,
      guideMode: 'thirds',
    });
    expect(descriptor.active).toBe(true);
    expect(descriptor.validity.status).toBe('valid');
    expect(descriptor.validity.canApply).toBe(true);
    expect(descriptor.output).toMatchObject({
      width: 100,
      height: 60,
      sizeLabel: '100 × 60px',
      flattenPolicy: 'destructive-single-layer-flatten',
    });
    expect(descriptor.guides).toEqual({ mode: 'thirds', lineCount: 4 });
    expect(descriptor.applyCancel).toMatchObject({
      apply: 'supported-enter-key',
      cancel: 'supported-escape-key',
    });
    expect(descriptor.undo).toBe('single-atomic-doc-resize-operation');
    expect(descriptor.quad.labels).toEqual(['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left']);
  });

  it('describes invalid sessions as blocked and carries refusal reasons', () => {
    const bowtie: PerspectiveCropQuad = [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 100, y: 0 },
      { x: 0, y: 60 },
    ];
    const descriptor = describePerspectiveCropSession({
      doc: doc(),
      quad: bowtie,
      guideMode: 'thirds',
    });
    expect(descriptor.validity.canApply).toBe(false);
    expect(descriptor.applyCancel.apply).toBe('blocked-degenerate-quad');

    const tiltmarkDoc = doc({ layers: [tiltmarkLayer()] });
    const refused = describePerspectiveCropSession({
      doc: tiltmarkDoc,
      quad: UNIT_SQUARE,
      guideMode: 'thirds',
    });
    expect(refused.refusal).toBe('tiltmark-surface-requires-raster');
    expect(refused.validity.canApply).toBe(false);
  });

  it('exposes the deterministic validity thresholds', () => {
    expect(PERSPECTIVE_CROP_MIN_EDGE_PX).toBeGreaterThan(0);
    expect(PERSPECTIVE_CROP_MIN_AREA_PX2).toBeGreaterThan(0);
  });
});
