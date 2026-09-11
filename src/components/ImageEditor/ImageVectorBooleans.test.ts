import { describe, expect, it } from 'vitest';
import type { ImageVectorPathPoint } from '../../types/imageEditor';
import {
  applyImageVectorBoolean,
  describeImageVectorBooleanSupport,
  describeImageVectorBooleanSupportMatrix,
  planImageVectorBooleanOperation,
  type ImageVectorBooleanPathDescriptor,
} from './ImageVectorBooleans';

function rect(left: number, top: number, right: number, bottom: number): ImageVectorBooleanPathDescriptor {
  return {
    closed: true,
    fillRule: 'evenodd',
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
  };
}

function polygon(points: ImageVectorPathPoint[]): ImageVectorBooleanPathDescriptor {
  return {
    closed: true,
    fillRule: 'evenodd',
    points,
  };
}

function resultPoints(result: ReturnType<typeof applyImageVectorBoolean>) {
  return result.descriptors.map((descriptor) => descriptor.points.map((point) => [point.x, point.y]));
}

describe('ImageVectorBooleans', () => {
  it('returns exact rectangle decomposition for overlapping rectangle booleans', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 15, 15);

    const union = applyImageVectorBoolean('union', a, b);
    const intersect = applyImageVectorBoolean('intersect', a, b);
    const subtract = applyImageVectorBoolean('subtract', a, b);
    const xor = applyImageVectorBoolean('xor', a, b);

    expect(union.status).toBe('exact');
    expect(union.warnings).toEqual([]);
    expect(resultPoints(union)).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
      ],
      [
        [0, 5],
        [15, 5],
        [15, 10],
        [0, 10],
      ],
      [
        [5, 10],
        [15, 10],
        [15, 15],
        [5, 15],
      ],
    ]);

    expect(intersect.status).toBe('exact');
    expect(resultPoints(intersect)).toEqual([
      [
        [5, 5],
        [10, 5],
        [10, 10],
        [5, 10],
      ],
    ]);

    expect(subtract.status).toBe('exact');
    expect(resultPoints(subtract)).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
      ],
      [
        [0, 5],
        [5, 5],
        [5, 10],
        [0, 10],
      ],
    ]);

    expect(xor.status).toBe('exact');
    expect(resultPoints(xor)).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
      ],
      [
        [0, 5],
        [5, 5],
        [5, 10],
        [0, 10],
      ],
      [
        [10, 5],
        [15, 5],
        [15, 10],
        [10, 10],
      ],
      [
        [5, 10],
        [15, 10],
        [15, 15],
        [5, 15],
      ],
    ]);
  });

  it('treats identical simple polygons as an exact bounded subset', () => {
    const triangle = polygon([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 3, y: 4 },
    ]);

    const union = applyImageVectorBoolean('union', triangle, triangle);
    const intersect = applyImageVectorBoolean('intersect', triangle, triangle);
    const subtract = applyImageVectorBoolean('subtract', triangle, triangle);
    const xor = applyImageVectorBoolean('xor', triangle, triangle);

    expect(union.status).toBe('exact');
    expect(resultPoints(union)).toEqual([[
      [0, 0],
      [6, 0],
      [3, 4],
    ]]);

    expect(intersect.status).toBe('exact');
    expect(resultPoints(intersect)).toEqual([[
      [0, 0],
      [6, 0],
      [3, 4],
    ]]);

    expect(subtract.status).toBe('exact');
    expect(subtract.descriptors).toEqual([]);

    expect(xor.status).toBe('exact');
    expect(xor.descriptors).toEqual([]);
  });

  it('materializes overlapping non-identical simple polygons through the clipper', () => {
    const triangle = polygon([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 3, y: 4 },
    ]);
    const diamond = polygon([
      { x: 3, y: 0 },
      { x: 6, y: 2 },
      { x: 3, y: 4 },
      { x: 0, y: 2 },
    ]);

    const result = applyImageVectorBoolean('union', triangle, diamond);

    // The shapes share vertices, so the clipper resolves them via perturbation.
    expect(result.status).toBe('approximate');
    expect(result.supportedSubset).toBe('overlapping-simple-polygons');
    expect(result.descriptors.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'degenerate-inputs-approximated',
      }),
    ]);
  });

  it('materializes cleanly overlapping simple polygons exactly via polygon clipping', () => {
    const square = rect(0, 0, 4, 4);
    // Diamond overlapping the square's right edge with proper crossings only
    // (no shared vertices, nothing on an edge endpoint): union area is
    // 16 + 4.5 − 1 = 19.5.
    const diamond = polygon([
      { x: 4.5, y: 0.5 },
      { x: 6, y: 2 },
      { x: 4.5, y: 3.5 },
      { x: 3, y: 2 },
    ]);

    const result = applyImageVectorBoolean('union', square, diamond);

    expect(result.status).toBe('exact');
    expect(result.supportedSubset).toBe('overlapping-simple-polygons');
    expect(result.descriptors).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    const ring = result.descriptors[0].points;
    const area = Math.abs(ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2);
    expect(area).toBeCloseTo(19.5, 6);
  });

  it('materializes disjoint simple polygon booleans exactly without rasterizing', () => {
    const triangle = polygon([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 3, y: 4 },
    ]);
    const diamond = polygon([
      { x: 12, y: 0 },
      { x: 16, y: 3 },
      { x: 12, y: 6 },
      { x: 8, y: 3 },
    ]);

    const union = applyImageVectorBoolean('union', triangle, diamond);
    const intersect = applyImageVectorBoolean('intersect', triangle, diamond);
    const subtract = applyImageVectorBoolean('subtract', triangle, diamond);
    const xor = applyImageVectorBoolean('xor', triangle, diamond);

    expect(union).toMatchObject({
      status: 'exact',
      supportedSubset: 'non-overlapping-simple-polygons',
      warnings: [],
    });
    expect(resultPoints(union)).toEqual([
      [
        [0, 0],
        [6, 0],
        [3, 4],
      ],
      [
        [12, 0],
        [16, 3],
        [12, 6],
        [8, 3],
      ],
    ]);

    expect(intersect).toMatchObject({
      status: 'exact',
      supportedSubset: 'non-overlapping-simple-polygons',
      descriptors: [],
      warnings: [],
    });
    expect(resultPoints(subtract)).toEqual([[
      [0, 0],
      [6, 0],
      [3, 4],
    ]]);
    expect(resultPoints(xor)).toEqual(resultPoints(union));
  });

  it('reports open paths as unsupported input instead of inventing geometry', () => {
    const result = applyImageVectorBoolean(
      'intersect',
      {
        closed: false,
        fillRule: 'evenodd',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      rect(0, 0, 10, 10),
    );

    expect(result.status).toBe('unsupported');
    expect(result.descriptors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'open-path-not-supported',
      }),
    ]);
  });

  it('exposes a deterministic boolean support matrix for future UI descriptors', () => {
    const support = describeImageVectorBooleanSupport();

    expect(support.operations.map((entry) => entry.operation)).toEqual([
      'union',
      'intersect',
      'subtract',
      'xor',
    ]);
    expect(support.operations.every((entry) => entry.supported)).toBe(true);
    expect(support.operations[0]).toMatchObject({
      exactSubsets: ['axis-aligned-rectangles', 'identical-simple-polygons', 'non-overlapping-simple-polygons', 'overlapping-simple-polygons'],
      previewSignatureFields: ['operation', 'inputASignature', 'inputBSignature', 'supportedSubset'],
    });
    expect(support.limitations).toContain('curved-bezier-segments-rasterize-or-convert-before-boolean');
    expect(support.rasterizeWarnings).toContain('unsupported-polygons-are-not-rasterized-automatically');
  });

  it('summarizes exact subsets, unsupported states, handoff caveats, and a stable matrix signature', () => {
    const matrix = describeImageVectorBooleanSupportMatrix();

    expect(matrix).toMatchObject({
      operations: [
        expect.objectContaining({
          operation: 'union',
          status: 'supported-exact-subset',
          exactSubsets: ['axis-aligned-rectangles', 'identical-simple-polygons', 'non-overlapping-simple-polygons', 'overlapping-simple-polygons'],
        }),
        expect.objectContaining({ operation: 'intersect' }),
        expect.objectContaining({ operation: 'subtract' }),
        expect.objectContaining({ operation: 'xor' }),
      ],
      unsupportedStates: [
        {
          code: 'bezier-segments-not-supported',
          severity: 'blocker',
          message: 'Curved Bezier path segments are not retained or materialized by vector booleans yet.',
          fallback: 'convert-curves-to-straight-path-or-rasterize-copy',
        },
        {
          code: 'live-boolean-stack-not-retained',
          severity: 'warning',
          message: 'Boolean results are materialized as output path descriptors without a live editable operation stack.',
          fallback: 'keep-source-layers-for-later-rebuild',
        },
      ],
      handoffCaveats: {
        svg: [
          'svg-export-preserves-materialized-path-descriptors-only',
          'svg-export-does-not-preserve-live-boolean-stack',
        ],
        psd: [
          'psd-export-carries-raster-preview-plus-vector-metadata',
          'native-psd-shape-layer-boolean-roundtrip-not-guaranteed',
        ],
      },
      previewSignatureFields: ['operations', 'exactSubsets', 'unsupportedStates'],
      previewSignature: 'boolean-support|union,intersect,subtract,xor|axis-aligned-rectangles,identical-simple-polygons,non-overlapping-simple-polygons,overlapping-simple-polygons|bezier-segments-not-supported,live-boolean-stack-not-retained',
    });
    expect(matrix.operations.every((operation) => operation.previewSignature === `${operation.operation}|${matrix.previewSignature}`)).toBe(true);
  });

  it('exposes a non-mutating blocker matrix for Bezier and overlapping polygon gaps', () => {
    const matrix = describeImageVectorBooleanSupportMatrix();

    expect(matrix.unsupportedResultPolicy).toEqual({
      nonMutating: true,
      sourceLayerMutation: 'none',
      unsupportedDescriptors: 'empty',
      fallbackHandoff: ['keep-source-paths-for-svg-psd-handoff', 'boolean-result-not-materialized-for-unsupported-inputs'],
    });
    expect(matrix.blockerMatrix).toEqual([
      expect.objectContaining({
        inputCase: 'bezier-segments',
        severity: 'blocker',
        resultStatus: 'unsupported',
        mutatesInputs: false,
        materializesDescriptors: false,
        unsupportedStateCode: 'bezier-segments-not-supported',
      }),
      expect.objectContaining({
        inputCase: 'live-boolean-stack',
        severity: 'warning',
        resultStatus: 'exact-materialized-with-warning',
        mutatesInputs: false,
        materializesDescriptors: true,
        unsupportedStateCode: 'live-boolean-stack-not-retained',
      }),
    ]);
    expect(matrix.handoffSignatures).toEqual({
      svg: 'svg|boolean-support|materialized-path-descriptors|no-live-stack',
      psd: 'psd|boolean-support|raster-preview-plus-vector-metadata|no-native-boolean-stack',
    });
  });

  it('plans boolean operations with stable input signatures and unsupported warnings', () => {
    const a = rect(0, 0, 10, 10);
    const b = polygon([
      { x: 0, y: 0 },
      { x: 8, y: 1 },
      { x: 3, y: 6 },
    ]);

    const plan = planImageVectorBooleanOperation('union', a, b);

    expect(plan).toMatchObject({
      operation: 'union',
      // The triangle shares (0,0) with the rectangle, so the clipper perturbs.
      status: 'approximate',
      supportedSubset: 'overlapping-simple-polygons',
      sourceMutation: 'none',
      unsupportedResultPolicy: {
        nonMutating: true,
        preservesInputs: true,
      },
      handoffSignatures: {
        svg: 'svg|union|closed:4:0,0;10,0;10,10;0,10|closed:3:0,0;8,1;3,6|overlapping-simple-polygons',
        psd: 'psd|union|closed:4:0,0;10,0;10,10;0,10|closed:3:0,0;8,1;3,6|overlapping-simple-polygons',
      },
      previewSignature: 'union|closed:4:0,0;10,0;10,10;0,10|closed:3:0,0;8,1;3,6|overlapping-simple-polygons',
    });
    expect(plan.descriptors.length).toBeGreaterThan(0);
    expect(plan.unsupportedResultPolicy.descriptors.length).toBe(plan.descriptors.length);
    expect(plan.warnings).toEqual([
      expect.objectContaining({
        code: 'degenerate-inputs-approximated',
      }),
    ]);
    expect(plan.handoffLimitations).toEqual([
      'boolean-result-is-flattened-to-output-path-descriptors',
      'source-operation-stack-is-not-retained',
    ]);
  });
});
