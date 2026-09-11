import type { ImageVectorPathPoint } from '../../types/imageEditor';
import { clipSimplePolygons } from './ImagePolygonBooleanClip';

export type ImageVectorBooleanOperation = 'union' | 'intersect' | 'subtract' | 'xor';
export type ImageVectorBooleanStatus = 'exact' | 'approximate' | 'unsupported';
export type ImageVectorBooleanFillRule = 'evenodd';
export type ImageVectorBooleanSupportStatus = 'supported-exact-subset';
export type ImageVectorBooleanUnsupportedStateCode =
  | 'bezier-segments-not-supported'
  | 'live-boolean-stack-not-retained';

export interface ImageVectorBooleanPathDescriptor {
  closed: boolean;
  fillRule: ImageVectorBooleanFillRule;
  points: ImageVectorPathPoint[];
}

export interface ImageVectorBooleanWarning {
  code:
    | 'empty-path'
    | 'open-path-not-supported'
    | 'non-simple-polygon-not-supported'
    | 'simple-polygon-boolean-not-supported'
    | 'compound-hole-result-evenodd'
    | 'degenerate-inputs-approximated';
  message: string;
}

export interface ImageVectorBooleanResult {
  operation: ImageVectorBooleanOperation;
  status: ImageVectorBooleanStatus;
  descriptors: ImageVectorBooleanPathDescriptor[];
  warnings: ImageVectorBooleanWarning[];
  supportedSubset:
    | 'axis-aligned-rectangles'
    | 'identical-simple-polygons'
    | 'non-overlapping-simple-polygons'
    | 'overlapping-simple-polygons'
    | 'none';
}

export interface ImageVectorBooleanOperationSupport {
  operation: ImageVectorBooleanOperation;
  supported: boolean;
  exactSubsets: Array<Exclude<ImageVectorBooleanResult['supportedSubset'], 'none'>>;
  previewSignatureFields: string[];
}

export interface ImageVectorBooleanUnsupportedStateDescriptor {
  code: ImageVectorBooleanUnsupportedStateCode;
  severity: 'warning' | 'blocker';
  message: string;
  fallback: string;
}

export interface ImageVectorBooleanSupportMatrixOperation {
  operation: ImageVectorBooleanOperation;
  status: ImageVectorBooleanSupportStatus;
  exactSubsets: Array<Exclude<ImageVectorBooleanResult['supportedSubset'], 'none'>>;
  unsupportedStateCodes: ImageVectorBooleanUnsupportedStateCode[];
  previewSignatureFields: string[];
  previewSignature: string;
}

export interface ImageVectorBooleanSupportMatrix {
  operations: ImageVectorBooleanSupportMatrixOperation[];
  exactSubsets: Array<Exclude<ImageVectorBooleanResult['supportedSubset'], 'none'>>;
  unsupportedStates: ImageVectorBooleanUnsupportedStateDescriptor[];
  blockerMatrix: ImageVectorBooleanBlockerMatrixEntry[];
  unsupportedResultPolicy: ImageVectorBooleanUnsupportedResultPolicy;
  handoffCaveats: {
    svg: string[];
    psd: string[];
  };
  handoffSignatures: {
    svg: string;
    psd: string;
  };
  previewSignatureFields: string[];
  previewSignature: string;
}

export interface ImageVectorBooleanSupportDescriptor {
  operations: ImageVectorBooleanOperationSupport[];
  limitations: string[];
  rasterizeWarnings: string[];
}

export interface ImageVectorBooleanOperationPlan extends ImageVectorBooleanResult {
  inputASignature: string;
  inputBSignature: string;
  sourceMutation: 'none';
  unsupportedResultPolicy: {
    nonMutating: true;
    descriptors: ImageVectorBooleanPathDescriptor[];
    preservesInputs: true;
  };
  handoffSignatures: {
    svg: string;
    psd: string;
  };
  previewSignature: string;
  handoffLimitations: string[];
}

export interface ImageVectorBooleanUnsupportedResultPolicy {
  nonMutating: true;
  sourceLayerMutation: 'none';
  unsupportedDescriptors: 'empty';
  fallbackHandoff: string[];
}

export interface ImageVectorBooleanBlockerMatrixEntry {
  inputCase: 'bezier-segments' | 'live-boolean-stack';
  severity: 'warning' | 'blocker';
  resultStatus: 'unsupported' | 'exact-materialized-with-warning';
  warningCode?: ImageVectorBooleanWarning['code'];
  unsupportedStateCode: ImageVectorBooleanUnsupportedStateCode;
  mutatesInputs: false;
  materializesDescriptors: boolean;
}

interface NormalizedPath {
  descriptor: ImageVectorBooleanPathDescriptor;
  polygon: ImageVectorPathPoint[];
  rectangle: Rectangle | null;
}

interface Rectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const VECTOR_BOOLEAN_OPERATIONS = ['union', 'intersect', 'subtract', 'xor'] satisfies ImageVectorBooleanOperation[];
const VECTOR_BOOLEAN_EXACT_SUBSETS = [
  'axis-aligned-rectangles',
  'identical-simple-polygons',
  'non-overlapping-simple-polygons',
  'overlapping-simple-polygons',
] satisfies Array<Exclude<ImageVectorBooleanResult['supportedSubset'], 'none'>>;
const VECTOR_BOOLEAN_UNSUPPORTED_STATES: ImageVectorBooleanUnsupportedStateDescriptor[] = [
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
];
const VECTOR_BOOLEAN_UNSUPPORTED_RESULT_POLICY: ImageVectorBooleanUnsupportedResultPolicy = {
  nonMutating: true,
  sourceLayerMutation: 'none',
  unsupportedDescriptors: 'empty',
  fallbackHandoff: ['keep-source-paths-for-svg-psd-handoff', 'boolean-result-not-materialized-for-unsupported-inputs'],
};
const VECTOR_BOOLEAN_BLOCKER_MATRIX: ImageVectorBooleanBlockerMatrixEntry[] = [
  {
    inputCase: 'bezier-segments',
    severity: 'blocker',
    resultStatus: 'unsupported',
    unsupportedStateCode: 'bezier-segments-not-supported',
    mutatesInputs: false,
    materializesDescriptors: false,
  },
  {
    inputCase: 'live-boolean-stack',
    severity: 'warning',
    resultStatus: 'exact-materialized-with-warning',
    unsupportedStateCode: 'live-boolean-stack-not-retained',
    mutatesInputs: false,
    materializesDescriptors: true,
  },
];

export function applyImageVectorBoolean(
  operation: ImageVectorBooleanOperation,
  a: ImageVectorBooleanPathDescriptor,
  b: ImageVectorBooleanPathDescriptor,
): ImageVectorBooleanResult {
  const normalizedA = normalizeInputPath(a);
  if ('warning' in normalizedA) {
    return unsupported(operation, normalizedA.warning);
  }

  const normalizedB = normalizeInputPath(b);
  if ('warning' in normalizedB) {
    return unsupported(operation, normalizedB.warning);
  }

  if (normalizedA.rectangle && normalizedB.rectangle) {
    return {
      operation,
      status: 'exact',
      descriptors: applyRectangleBoolean(operation, normalizedA.rectangle, normalizedB.rectangle),
      warnings: [],
      supportedSubset: 'axis-aligned-rectangles',
    };
  }

  if (polygonsMatch(normalizedA.polygon, normalizedB.polygon)) {
    return {
      operation,
      status: 'exact',
      descriptors: operation === 'subtract' || operation === 'xor' ? [] : [cloneDescriptor(normalizedA.descriptor)],
      warnings: [],
      supportedSubset: 'identical-simple-polygons',
    };
  }

  if (polygonsAreDisjoint(normalizedA.polygon, normalizedB.polygon)) {
    return {
      operation,
      status: 'exact',
      descriptors: applyDisjointPolygonBoolean(operation, normalizedA.descriptor, normalizedB.descriptor),
      warnings: [],
      supportedSubset: 'non-overlapping-simple-polygons',
    };
  }

  // General overlapping simple polygons: real polygon clipping (Greiner–Hormann).
  const clipped = clipSimplePolygons(
    operation,
    normalizedA.polygon.map((point) => ({ x: point.x, y: point.y })),
    normalizedB.polygon.map((point) => ({ x: point.x, y: point.y })),
  );
  const warnings: ImageVectorBooleanWarning[] = [];
  if (clipped.approximate) {
    warnings.push({
      code: 'degenerate-inputs-approximated',
      message:
        'Shared vertices or edge-touching inputs were minutely perturbed to resolve the boolean; the result is a close approximation.',
    });
  }
  if (clipped.containsHoles) {
    warnings.push({
      code: 'compound-hole-result-evenodd',
      message:
        'The result encloses one or more holes; the output rings render correctly together under even-odd fill but are materialized as separate paths.',
    });
  }
  return {
    operation,
    status: clipped.approximate ? 'approximate' : 'exact',
    descriptors: clipped.rings.map((ring) => ({
      closed: true,
      fillRule: 'evenodd' as const,
      points: ring.map((point) => ({ x: point.x, y: point.y })),
    })),
    warnings,
    supportedSubset: 'overlapping-simple-polygons',
  };
}

export function describeImageVectorBooleanSupport(): ImageVectorBooleanSupportDescriptor {
  return {
    operations: VECTOR_BOOLEAN_OPERATIONS.map((operation) => ({
      operation,
      supported: true,
      exactSubsets: [...VECTOR_BOOLEAN_EXACT_SUBSETS],
      previewSignatureFields: ['operation', 'inputASignature', 'inputBSignature', 'supportedSubset'],
    })),
    limitations: [
      'compound-path-holes-preserve-evenodd-only',
      'curved-bezier-segments-rasterize-or-convert-before-boolean',
      'degenerate-shared-vertex-inputs-resolve-approximately',
    ],
    rasterizeWarnings: [
      'unsupported-polygons-are-not-rasterized-automatically',
      'rasterize-after-boolean-discards-source-path-editability',
    ],
  };
}

export function describeImageVectorBooleanSupportMatrix(): ImageVectorBooleanSupportMatrix {
  const unsupportedStateCodes = VECTOR_BOOLEAN_UNSUPPORTED_STATES.map((state) => state.code);
  const previewSignature = [
    'boolean-support',
    VECTOR_BOOLEAN_OPERATIONS.join(','),
    VECTOR_BOOLEAN_EXACT_SUBSETS.join(','),
    unsupportedStateCodes.join(','),
  ].join('|');

  return {
    operations: VECTOR_BOOLEAN_OPERATIONS.map((operation) => ({
      operation,
      status: 'supported-exact-subset',
      exactSubsets: [...VECTOR_BOOLEAN_EXACT_SUBSETS],
      unsupportedStateCodes: [...unsupportedStateCodes],
      previewSignatureFields: ['operation', 'supportMatrixSignature'],
      previewSignature: `${operation}|${previewSignature}`,
    })),
    exactSubsets: [...VECTOR_BOOLEAN_EXACT_SUBSETS],
    unsupportedStates: VECTOR_BOOLEAN_UNSUPPORTED_STATES.map((state) => ({ ...state })),
    blockerMatrix: VECTOR_BOOLEAN_BLOCKER_MATRIX.map((entry) => ({ ...entry })),
    unsupportedResultPolicy: {
      ...VECTOR_BOOLEAN_UNSUPPORTED_RESULT_POLICY,
      fallbackHandoff: [...VECTOR_BOOLEAN_UNSUPPORTED_RESULT_POLICY.fallbackHandoff],
    },
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
    handoffSignatures: {
      svg: 'svg|boolean-support|materialized-path-descriptors|no-live-stack',
      psd: 'psd|boolean-support|raster-preview-plus-vector-metadata|no-native-boolean-stack',
    },
    previewSignatureFields: ['operations', 'exactSubsets', 'unsupportedStates'],
    previewSignature,
  };
}

export function planImageVectorBooleanOperation(
  operation: ImageVectorBooleanOperation,
  a: ImageVectorBooleanPathDescriptor,
  b: ImageVectorBooleanPathDescriptor,
): ImageVectorBooleanOperationPlan {
  const result = applyImageVectorBoolean(operation, a, b);
  const inputASignature = buildBooleanInputSignature(a);
  const inputBSignature = buildBooleanInputSignature(b);
  return {
    ...result,
    inputASignature,
    inputBSignature,
    sourceMutation: 'none',
    unsupportedResultPolicy: {
      nonMutating: true,
      descriptors: result.status === 'unsupported' ? [] : result.descriptors.map(cloneDescriptor),
      preservesInputs: true,
    },
    handoffSignatures: {
      svg: `svg|${operation}|${inputASignature}|${inputBSignature}|${result.status === 'unsupported' ? 'unsupported' : result.supportedSubset}`,
      psd: `psd|${operation}|${inputASignature}|${inputBSignature}|${result.status === 'unsupported' ? 'unsupported' : result.supportedSubset}`,
    },
    previewSignature: `${operation}|${inputASignature}|${inputBSignature}|${result.supportedSubset}`,
    handoffLimitations: result.status === 'unsupported'
      ? [
          'keep-source-paths-for-svg-psd-handoff',
          'boolean-result-not-materialized-for-unsupported-inputs',
        ]
      : [
          'boolean-result-is-flattened-to-output-path-descriptors',
          'source-operation-stack-is-not-retained',
        ],
  };
}

function normalizeInputPath(path: ImageVectorBooleanPathDescriptor): NormalizedPath | { warning: ImageVectorBooleanWarning } {
  if (!path.closed) {
    return {
      warning: {
        code: 'open-path-not-supported',
        message: 'Boolean operations require closed paths.',
      },
    };
  }

  const polygon = path.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: Math.round(point.x * 1000) / 1000,
      y: Math.round(point.y * 1000) / 1000,
    }));

  if (polygon.length < 3) {
    return {
      warning: {
        code: 'empty-path',
        message: 'Boolean operations require at least three finite points.',
      },
    };
  }

  const compactPolygon = dedupeSequentialPoints(polygon);
  if (compactPolygon.length < 3) {
    return {
      warning: {
        code: 'empty-path',
        message: 'Boolean operations require at least three distinct points.',
      },
    };
  }

  if (!isSimplePolygon(compactPolygon)) {
    return {
      warning: {
        code: 'non-simple-polygon-not-supported',
        message: 'Boolean operations currently reject self-intersecting polygons.',
      },
    };
  }

  const descriptor: ImageVectorBooleanPathDescriptor = {
    closed: true,
    fillRule: 'evenodd',
    points: compactPolygon.map((point) => ({ ...point })),
  };

  return {
    descriptor,
    polygon: compactPolygon,
    rectangle: asAxisAlignedRectangle(compactPolygon),
  };
}

function applyRectangleBoolean(
  operation: ImageVectorBooleanOperation,
  a: Rectangle,
  b: Rectangle,
): ImageVectorBooleanPathDescriptor[] {
  const xs = uniqueSorted([a.left, a.right, b.left, b.right]);
  const ys = uniqueSorted([a.top, a.bottom, b.top, b.bottom]);
  const cells: Rectangle[] = [];

  for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
    const top = ys[yIndex]!;
    const bottom = ys[yIndex + 1]!;
    for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
      const left = xs[xIndex]!;
      const right = xs[xIndex + 1]!;
      const sampleX = (left + right) / 2;
      const sampleY = (top + bottom) / 2;
      const inA = rectangleContains(a, sampleX, sampleY);
      const inB = rectangleContains(b, sampleX, sampleY);
      if (applyMembershipBoolean(operation, inA, inB)) {
        cells.push({ left, top, right, bottom });
      }
    }
  }

  return mergeRectangles(cells).map(rectangleToDescriptor);
}

function applyDisjointPolygonBoolean(
  operation: ImageVectorBooleanOperation,
  a: ImageVectorBooleanPathDescriptor,
  b: ImageVectorBooleanPathDescriptor,
): ImageVectorBooleanPathDescriptor[] {
  switch (operation) {
    case 'union':
    case 'xor':
      return [cloneDescriptor(a), cloneDescriptor(b)];
    case 'intersect':
      return [];
    case 'subtract':
      return [cloneDescriptor(a)];
  }
}

function mergeRectangles(rectangles: Rectangle[]): Rectangle[] {
  const mergedRows = new Map<string, Rectangle[]>();
  const rowKeys = uniqueSorted(rectangles.map((rectangle) => rectangle.top))
    .flatMap((top) => uniqueSorted(rectangles.filter((rectangle) => rectangle.top === top).map((rectangle) => rectangle.bottom))
      .map((bottom) => `${top}:${bottom}`));

  rowKeys.forEach((key) => {
    const [topText, bottomText] = key.split(':');
    const top = Number(topText);
    const bottom = Number(bottomText);
    const row = rectangles
      .filter((rectangle) => rectangle.top === top && rectangle.bottom === bottom)
      .sort((first, second) => first.left - second.left || first.right - second.right);
    const merged: Rectangle[] = [];

    row.forEach((rectangle) => {
      const last = merged[merged.length - 1];
      if (last && last.right === rectangle.left) {
        last.right = rectangle.right;
      } else {
        merged.push({ ...rectangle });
      }
    });

    mergedRows.set(key, merged);
  });

  const output: Rectangle[] = [];
  rowKeys.forEach((key) => {
    const row = mergedRows.get(key) ?? [];
    row.forEach((rectangle) => {
      const last = output[output.length - 1];
      if (
        last
        && last.left === rectangle.left
        && last.right === rectangle.right
        && last.bottom === rectangle.top
      ) {
        last.bottom = rectangle.bottom;
      } else {
        output.push({ ...rectangle });
      }
    });
  });

  return output;
}

function rectangleToDescriptor(rectangle: Rectangle): ImageVectorBooleanPathDescriptor {
  return {
    closed: true,
    fillRule: 'evenodd',
    points: [
      { x: rectangle.left, y: rectangle.top },
      { x: rectangle.right, y: rectangle.top },
      { x: rectangle.right, y: rectangle.bottom },
      { x: rectangle.left, y: rectangle.bottom },
    ],
  };
}

function applyMembershipBoolean(operation: ImageVectorBooleanOperation, inA: boolean, inB: boolean): boolean {
  switch (operation) {
    case 'union':
      return inA || inB;
    case 'intersect':
      return inA && inB;
    case 'subtract':
      return inA && !inB;
    case 'xor':
      return inA !== inB;
    default:
      return false;
  }
}

function rectangleContains(rectangle: Rectangle, x: number, y: number): boolean {
  return x >= rectangle.left && x < rectangle.right && y >= rectangle.top && y < rectangle.bottom;
}

function asAxisAlignedRectangle(points: ImageVectorPathPoint[]): Rectangle | null {
  if (points.length !== 4) return null;
  const xs = uniqueSorted(points.map((point) => point.x));
  const ys = uniqueSorted(points.map((point) => point.y));
  if (xs.length !== 2 || ys.length !== 2) return null;

  const expected = new Set([
    `${xs[0]}:${ys[0]}`,
    `${xs[1]}:${ys[0]}`,
    `${xs[1]}:${ys[1]}`,
    `${xs[0]}:${ys[1]}`,
  ]);
  const actual = new Set(points.map((point) => `${point.x}:${point.y}`));
  if (actual.size !== 4 || actual.size !== expected.size) return null;
  for (const key of expected) {
    if (!actual.has(key)) return null;
  }

  return {
    left: xs[0]!,
    top: ys[0]!,
    right: xs[1]!,
    bottom: ys[1]!,
  };
}

function polygonsMatch(a: ImageVectorPathPoint[], b: ImageVectorPathPoint[]): boolean {
  if (a.length !== b.length) return false;
  const normalizedA = canonicalizePolygon(a);
  const normalizedB = canonicalizePolygon(b);
  return normalizedA.every((point, index) => point.x === normalizedB[index]?.x && point.y === normalizedB[index]?.y);
}

function polygonsAreDisjoint(a: ImageVectorPathPoint[], b: ImageVectorPathPoint[]): boolean {
  const aSegments = polygonSegments(a);
  const bSegments = polygonSegments(b);
  if (aSegments.some((aSegment) => bSegments.some((bSegment) => (
    segmentsIntersect(aSegment.start, aSegment.end, bSegment.start, bSegment.end)
  )))) {
    return false;
  }
  if (a.some((point) => pointInPolygon(point, b, true))) return false;
  if (b.some((point) => pointInPolygon(point, a, true))) return false;
  return true;
}

function polygonSegments(points: ImageVectorPathPoint[]): Array<{ start: ImageVectorPathPoint; end: ImageVectorPathPoint }> {
  return points.map((point, index) => ({
    start: point,
    end: points[(index + 1) % points.length]!,
  }));
}

function pointInPolygon(
  point: ImageVectorPathPoint,
  polygon: ImageVectorPathPoint[],
  includeBoundary: boolean,
): boolean {
  if (includeBoundary && polygonSegments(polygon).some((segment) => onSegment(segment.start, point, segment.end))) {
    return true;
  }

  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index]!;
    const previous = polygon[previousIndex]!;
    const crossesRay = (current.y > point.y) !== (previous.y > point.y);
    if (!crossesRay) continue;
    const xAtY = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function canonicalizePolygon(points: ImageVectorPathPoint[]): ImageVectorPathPoint[] {
  const rotations = buildRotations(points);
  const reversed = buildRotations([...points].reverse());
  return [...rotations, ...reversed].sort(comparePolygonPointLists)[0]!.map((point) => ({ ...point }));
}

function buildRotations(points: ImageVectorPathPoint[]): ImageVectorPathPoint[][] {
  return points.map((_, index) => points.slice(index).concat(points.slice(0, index)));
}

function comparePolygonPointLists(a: ImageVectorPathPoint[], b: ImageVectorPathPoint[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const deltaX = a[index]!.x - b[index]!.x;
    if (deltaX !== 0) return deltaX;
    const deltaY = a[index]!.y - b[index]!.y;
    if (deltaY !== 0) return deltaY;
  }
  return a.length - b.length;
}

function dedupeSequentialPoints(points: ImageVectorPathPoint[]): ImageVectorPathPoint[] {
  const deduped = points.filter((point, index) => {
    const previous = index === 0 ? points[points.length - 1] : points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  if (deduped.length > 1) {
    const first = deduped[0]!;
    const last = deduped[deduped.length - 1]!;
    if (first.x === last.x && first.y === last.y) {
      deduped.pop();
    }
  }
  return deduped;
}

function isSimplePolygon(points: ImageVectorPathPoint[]): boolean {
  const segments = points.map((point, index) => ({
    start: point,
    end: points[(index + 1) % points.length]!,
    index,
  }));

  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index]!;
    for (let otherIndex = index + 1; otherIndex < segments.length; otherIndex += 1) {
      const other = segments[otherIndex]!;
      if (segmentsAreAdjacent(current.index, other.index, segments.length)) continue;
      if (segmentsIntersect(current.start, current.end, other.start, other.end)) {
        return false;
      }
    }
  }

  return true;
}

function segmentsAreAdjacent(aIndex: number, bIndex: number, total: number): boolean {
  if (aIndex === bIndex) return true;
  if (Math.abs(aIndex - bIndex) === 1) return true;
  return Math.abs(aIndex - bIndex) === total - 1;
}

function segmentsIntersect(
  aStart: ImageVectorPathPoint,
  aEnd: ImageVectorPathPoint,
  bStart: ImageVectorPathPoint,
  bEnd: ImageVectorPathPoint,
): boolean {
  const a1 = orientation(aStart, aEnd, bStart);
  const a2 = orientation(aStart, aEnd, bEnd);
  const b1 = orientation(bStart, bEnd, aStart);
  const b2 = orientation(bStart, bEnd, aEnd);

  if (a1 === 0 && onSegment(aStart, bStart, aEnd)) return true;
  if (a2 === 0 && onSegment(aStart, bEnd, aEnd)) return true;
  if (b1 === 0 && onSegment(bStart, aStart, bEnd)) return true;
  if (b2 === 0 && onSegment(bStart, aEnd, bEnd)) return true;

  return (a1 > 0) !== (a2 > 0) && (b1 > 0) !== (b2 > 0);
}

function orientation(a: ImageVectorPathPoint, b: ImageVectorPathPoint, c: ImageVectorPathPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(a: ImageVectorPathPoint, b: ImageVectorPathPoint, c: ImageVectorPathPoint): boolean {
  return b.x <= Math.max(a.x, c.x)
    && b.x >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y)
    && b.y >= Math.min(a.y, c.y);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function cloneDescriptor(descriptor: ImageVectorBooleanPathDescriptor): ImageVectorBooleanPathDescriptor {
  return {
    closed: descriptor.closed,
    fillRule: descriptor.fillRule,
    points: descriptor.points.map((point) => ({ ...point })),
  };
}

function buildBooleanInputSignature(descriptor: ImageVectorBooleanPathDescriptor): string {
  const pathState = descriptor.closed ? 'closed' : 'open';
  const points = descriptor.points.map((point) => `${formatSignatureNumber(point.x)},${formatSignatureNumber(point.y)}`).join(';');
  return `${pathState}:${descriptor.points.length}:${points}`;
}

function formatSignatureNumber(value: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function unsupported(
  operation: ImageVectorBooleanOperation,
  warning: ImageVectorBooleanWarning,
): ImageVectorBooleanResult {
  return {
    operation,
    status: 'unsupported',
    descriptors: [],
    warnings: [warning],
    supportedSubset: 'none',
  };
}
