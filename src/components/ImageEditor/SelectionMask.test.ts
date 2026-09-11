import { describe, expect, it } from 'vitest';
import {
  cloneMask,
  combineMasks,
  createMask,
  describeAlphaMaskCombineMode,
  describeSelectionMaskOverlay,
  describeSelectionMaskPersistence,
  fillMask,
  fromSnapshot,
  invertMask,
  isMaskEmpty,
  maskBoundingBox,
  setEllipse,
  setFloodFill,
  setPolygon,
  setRect,
  toSnapshot,
} from './SelectionMask';

describe('SelectionMask — basic ops', () => {
  it('createMask returns zeroed buffer of correct size', () => {
    const m = createMask(4, 3);
    expect(m.width).toBe(4);
    expect(m.height).toBe(3);
    expect(m.data.length).toBe(12);
    expect(isMaskEmpty(m)).toBe(true);
  });

  it('fillMask + isMaskEmpty', () => {
    const m = createMask(2, 2);
    fillMask(m);
    expect(isMaskEmpty(m)).toBe(false);
    expect(Array.from(m.data)).toEqual([255, 255, 255, 255]);
  });

  it('cloneMask is independent of original', () => {
    const m = createMask(2, 2);
    fillMask(m);
    const c = cloneMask(m);
    c.data[0] = 0;
    expect(m.data[0]).toBe(255);
  });

  it('invertMask flips alpha', () => {
    const m = createMask(2, 2);
    m.data.set([0, 128, 255, 64]);
    invertMask(m);
    expect(Array.from(m.data)).toEqual([255, 127, 0, 191]);
  });

  it('toSnapshot/fromSnapshot round-trips', () => {
    const m = createMask(3, 1);
    m.data.set([10, 20, 30]);
    const snap = toSnapshot(m);
    const restored = fromSnapshot(snap);
    expect(Array.from(restored.data)).toEqual([10, 20, 30]);
    snap.data[0] = 99;
    expect(restored.data[0]).toBe(10);
  });
});

describe('SelectionMask — combineMasks', () => {
  function maskFrom(values: number[][]): ReturnType<typeof createMask> {
    const m = createMask(values[0].length, values.length);
    for (let y = 0; y < values.length; y += 1) {
      for (let x = 0; x < values[y].length; x += 1) {
        m.data[y * m.width + x] = values[y][x];
      }
    }
    return m;
  }

  it('replace overwrites target', () => {
    const t = maskFrom([[10, 20]]);
    const s = maskFrom([[200, 0]]);
    combineMasks(t, s, 'replace');
    expect(Array.from(t.data)).toEqual([200, 0]);
  });

  it('add takes max per pixel', () => {
    const t = maskFrom([[10, 200]]);
    const s = maskFrom([[100, 50]]);
    combineMasks(t, s, 'add');
    expect(Array.from(t.data)).toEqual([100, 200]);
  });

  it('subtract clamps at 0', () => {
    const t = maskFrom([[100, 50]]);
    const s = maskFrom([[40, 200]]);
    combineMasks(t, s, 'subtract');
    expect(Array.from(t.data)).toEqual([60, 0]);
  });

  it('intersect takes min per pixel', () => {
    const t = maskFrom([[100, 200]]);
    const s = maskFrom([[150, 50]]);
    combineMasks(t, s, 'intersect');
    expect(Array.from(t.data)).toEqual([100, 50]);
  });

  it('mismatched dimensions throw', () => {
    const t = createMask(2, 2);
    const s = createMask(3, 3);
    expect(() => combineMasks(t, s, 'replace')).toThrow();
  });

  it('describes alpha combine modes with deterministic formulas', () => {
    const modes = ['replace', 'add', 'subtract', 'intersect'] as const;

    expect(modes.map((mode) => describeAlphaMaskCombineMode(mode))).toEqual([
      {
        kind: 'alpha-mask-combine-mode',
        mode: 'replace',
        label: 'Replace Selection',
        alphaRule: 'target = source',
        previewFormula: 'source',
        preservesPartialAlpha: true,
        monotonicity: 'source-defined',
        signature: 'alpha-mask-combine:v1:replace:source',
      },
      {
        kind: 'alpha-mask-combine-mode',
        mode: 'add',
        label: 'Add to Selection',
        alphaRule: 'target = max(target, source)',
        previewFormula: 'max(target, source)',
        preservesPartialAlpha: true,
        monotonicity: 'expands-or-preserves-alpha',
        signature: 'alpha-mask-combine:v1:add:max(target, source)',
      },
      {
        kind: 'alpha-mask-combine-mode',
        mode: 'subtract',
        label: 'Subtract from Selection',
        alphaRule: 'target = max(0, target - source)',
        previewFormula: 'max(0, target - source)',
        preservesPartialAlpha: true,
        monotonicity: 'reduces-or-preserves-alpha',
        signature: 'alpha-mask-combine:v1:subtract:max(0, target - source)',
      },
      {
        kind: 'alpha-mask-combine-mode',
        mode: 'intersect',
        label: 'Intersect with Selection',
        alphaRule: 'target = min(target, source)',
        previewFormula: 'min(target, source)',
        preservesPartialAlpha: true,
        monotonicity: 'reduces-or-preserves-alpha',
        signature: 'alpha-mask-combine:v1:intersect:min(target, source)',
      },
    ]);
  });
});

describe('SelectionMask — overlay descriptors', () => {
  it('summarizes alpha coverage with feather and opacity display metadata', () => {
    const mask = createMask(4, 1);
    mask.data.set([0, 64, 255, 128]);
    const descriptor = describeSelectionMaskOverlay(
      mask,
      {
        label: 'Alpha 1',
        tintColor: '#ff00ff',
        opacity: 0.424,
        featherPx: 3.456,
      },
    );

    expect(descriptor).toMatchObject({
      kind: 'selection-mask-overlay',
      label: 'Alpha 1',
      size: { width: 4, height: 1 },
      alpha: {
        transparentPixels: 1,
        partialPixels: 2,
        fullPixels: 1,
        minAlpha: 0,
        maxAlpha: 255,
        averageAlpha: 111.75,
      },
      display: {
        tintColor: '#ff00ff',
        opacity: 0.424,
        opacityLabel: '42%',
        featherPx: 3.46,
        featherLabel: '3.46 px',
      },
      warnings: [
        {
          code: 'selection-mask-feather-display-only',
        },
        {
          code: 'selection-mask-richer-visualization-unsupported',
        },
      ],
      limitations: [
        'Feather is displayed as descriptor metadata; this helper does not blur or mutate mask pixels.',
        'Advanced marching-ants animation, per-edge colorization, and channel-specific matte views are not represented by this descriptor.',
      ],
    });
    expect(descriptor?.signature).toBe(
      'selection-mask-overlay:v1:{"label":"Alpha 1","width":4,"height":1,"alpha":{"transparentPixels":1,"partialPixels":2,"fullPixels":1,"minAlpha":0,"maxAlpha":255,"averageAlpha":111.75},"display":{"opacity":0.424,"featherPx":3.46},"warnings":["selection-mask-feather-display-only","selection-mask-richer-visualization-unsupported"]}',
    );
  });

  it('describes saved-selection round-trip metadata with deterministic warnings and signature', () => {
    const mask = createMask(4, 1);
    mask.data.set([0, 64, 255, 128]);

    expect(describeSelectionMaskPersistence(mask, {
      label: 'Subject A',
      storageTarget: 'saved-selection-alpha-channel',
    })).toEqual({
      kind: 'selection-mask-persistence',
      label: 'Subject A',
      storageTarget: 'saved-selection-alpha-channel',
      loadTarget: 'document-selection',
      roundTrip: 'lossless-alpha-mask',
      hasSelection: true,
      partialAlpha: true,
      warnings: [
        {
          code: 'selection-mask-saved-selection-metadata-only',
          severity: 'warning',
          message: 'Saved-selection round-trip is represented as alpha-mask metadata; native channel UI/export is not modeled here.',
        },
      ],
      signature:
        'selection-mask-persistence:v1:{"label":"Subject A","storageTarget":"saved-selection-alpha-channel","loadTarget":"document-selection","roundTrip":"lossless-alpha-mask","hasSelection":true,"partialAlpha":true,"warnings":["selection-mask-saved-selection-metadata-only"]}',
    });
  });
});

describe('SelectionMask — setRect', () => {
  it('fills the interior at full alpha when antiAlias=false', () => {
    const m = createMask(4, 4);
    setRect(m, 1, 1, 2, 2, 255, false);
    const expected = [
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ];
    expect(Array.from(m.data)).toEqual(expected);
  });

  it('produces fractional coverage at fractional edges with antiAlias=true', () => {
    const m = createMask(4, 1);
    setRect(m, 0.5, 0, 2, 1, 255, true);
    // pixel 0 covered 0.5 wide → 128
    // pixel 1 fully covered → 255
    // pixel 2 covered 0.5 wide → 128
    // pixel 3 untouched
    expect(m.data[0]).toBe(Math.round(255 * 0.5));
    expect(m.data[1]).toBe(255);
    expect(m.data[2]).toBe(Math.round(255 * 0.5));
    expect(m.data[3]).toBe(0);
  });

  it('clips to mask bounds', () => {
    const m = createMask(2, 2);
    setRect(m, -1, -1, 4, 4, 255, false);
    expect(Array.from(m.data)).toEqual([255, 255, 255, 255]);
  });

  it('handles negative width/height by normalizing', () => {
    const m = createMask(4, 4);
    setRect(m, 3, 3, -2, -2, 255, false);
    const expected = [
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ];
    expect(Array.from(m.data)).toEqual(expected);
  });
});

describe('SelectionMask — setEllipse', () => {
  it('fills center fully and leaves corners untouched (antiAlias=false)', () => {
    const m = createMask(5, 5);
    setEllipse(m, 2.5, 2.5, 2, 2, 255, false);
    expect(m.data[2 * 5 + 2]).toBe(255);
    expect(m.data[0]).toBe(0);
    expect(m.data[4]).toBe(0);
    expect(m.data[5 * 5 - 1]).toBe(0);
  });

  it('zero radius is a no-op', () => {
    const m = createMask(3, 3);
    setEllipse(m, 1, 1, 0, 0);
    expect(isMaskEmpty(m)).toBe(true);
  });
});

describe('SelectionMask — setPolygon', () => {
  it('fills a triangle scanline-correctly', () => {
    const m = createMask(5, 5);
    setPolygon(m, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]);
    // expect upper-left triangular region filled
    expect(m.data[0]).toBe(255); // (0,0)
    expect(m.data[4]).toBe(0);   // (4,0) — corner is on edge, fill rule excludes
    expect(m.data[5 * 4]).toBe(0); // (0,4)
    expect(m.data[5 * 5 - 1]).toBe(0); // (4,4) outside triangle
  });

  it('skips polygons with fewer than 3 points', () => {
    const m = createMask(2, 2);
    setPolygon(m, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(isMaskEmpty(m)).toBe(true);
  });
});

describe('SelectionMask — setFloodFill', () => {
  function makeImage(width: number, height: number, pixels: [number, number, number][]): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 1) {
      const [r, g, b] = pixels[i];
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    return { width, height, data, colorSpace: 'srgb' } as ImageData;
  }

  it('fills contiguous same-color region within tolerance', () => {
    const w = 4;
    const h = 4;
    const RED: [number, number, number] = [255, 0, 0];
    const BLU: [number, number, number] = [0, 0, 255];
    const pixels: [number, number, number][] = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        pixels.push(x < 2 ? RED : BLU);
      }
    }
    const img = makeImage(w, h, pixels);
    const mask = createMask(w, h);
    setFloodFill(mask, img, 0, 0, 10);
    // Expect left half filled
    const expected = [
      255, 255, 0, 0,
      255, 255, 0, 0,
      255, 255, 0, 0,
      255, 255, 0, 0,
    ];
    expect(Array.from(mask.data)).toEqual(expected);
  });

  it('can match non-contiguous pixels when contiguous matching is disabled', () => {
    const img = makeImage(3, 1, [
      [255, 0, 0],
      [0, 0, 255],
      [255, 0, 0],
    ]);
    const mask = createMask(3, 1);
    (setFloodFill as unknown as (
      mask: ReturnType<typeof createMask>,
      image: ImageData,
      x: number,
      y: number,
      tolerance: number,
      contiguous: boolean,
    ) => void)(mask, img, 0, 0, 0, false);

    expect(Array.from(mask.data)).toEqual([255, 0, 255]);
  });

  it('rejects out-of-bounds seed', () => {
    const img = makeImage(2, 2, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const mask = createMask(2, 2);
    setFloodFill(mask, img, -1, 0, 10);
    expect(isMaskEmpty(mask)).toBe(true);
  });
});

describe('SelectionMask — maskBoundingBox', () => {
  it('returns null for empty mask', () => {
    expect(maskBoundingBox(createMask(4, 4))).toBeNull();
  });

  it('finds the minimal enclosing box', () => {
    const m = createMask(6, 6);
    setRect(m, 2, 1, 3, 4, 255, false);
    const bbox = maskBoundingBox(m);
    expect(bbox).toEqual({ x: 2, y: 1, width: 3, height: 4 });
  });
});
