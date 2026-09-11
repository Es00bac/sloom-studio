// Pure polygon boolean clipping (Greiner–Hormann) for simple polygons with
// straight segments — the algorithmic core behind overlapping vector-shape
// booleans. Canvas-free by design (descriptor/parity scaffolding rule): it
// operates on plain {x,y} rings and knows nothing about layers or rendering.
//
// Robustness contract: proper crossings are computed exactly in floating
// point; DEGENERATE inputs (shared vertices, endpoints on edges, collinear
// overlapping edges) are handled by minutely perturbing the clip polygon and
// retrying, and the result is then flagged `approximate: true` so callers can
// surface honest status instead of silently pretending exactness.

export type PolygonBooleanOperation = 'union' | 'intersect' | 'subtract' | 'xor';

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface PolygonClipResult {
  rings: PolygonPoint[][];
  /** True when degeneracy perturbation was required (or ops composed from perturbed runs). */
  approximate: boolean;
  /** True when some output ring lies inside another (even-odd hole semantics needed). */
  containsHoles: boolean;
}

interface ClipVertex {
  x: number;
  y: number;
  next: ClipVertex;
  prev: ClipVertex;
  intersect: boolean;
  entry: boolean;
  visited: boolean;
  neighbour: ClipVertex | null;
  alpha: number;
}

const AREA_EPSILON = 1e-9;
const MAX_PERTURB_ATTEMPTS = 4;

export function polygonArea(ring: PolygonPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function pointInsideRing(point: PolygonPoint, ring: PolygonPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function ringBoundsDiagonal(rings: PolygonPoint[][]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return Math.hypot(maxX - minX, maxY - minY) || 1;
}

function dedupeRing(ring: PolygonPoint[]): PolygonPoint[] {
  const out: PolygonPoint[] = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - point.x) > 1e-12 || Math.abs(last.y - point.y) > 1e-12) {
      out.push({ x: point.x, y: point.y });
    }
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first.x - last.x) <= 1e-12 && Math.abs(first.y - last.y) <= 1e-12) {
      out.pop();
    } else {
      break;
    }
  }
  return out;
}

interface IntersectionScanResult {
  degenerate: boolean;
  count: number;
  subjectList: ClipVertex;
  clipList: ClipVertex;
}

function buildList(ring: PolygonPoint[]): ClipVertex {
  let first: ClipVertex | null = null;
  let prev: ClipVertex | null = null;
  for (const point of ring) {
    const vertex: ClipVertex = {
      x: point.x,
      y: point.y,
      next: null as unknown as ClipVertex,
      prev: null as unknown as ClipVertex,
      intersect: false,
      entry: false,
      visited: false,
      neighbour: null,
      alpha: 0,
    };
    if (!first) {
      first = vertex;
      vertex.next = vertex;
      vertex.prev = vertex;
    } else {
      vertex.prev = prev as ClipVertex;
      vertex.next = first;
      (prev as ClipVertex).next = vertex;
      first.prev = vertex;
    }
    prev = vertex;
  }
  if (!first) {
    throw new Error('Polygon boolean clipping requires non-empty rings.');
  }
  return first;
}

function* iterateSourceVertices(first: ClipVertex): Generator<ClipVertex> {
  let current = first;
  do {
    if (!current.intersect) yield current;
    current = current.next;
  } while (current !== first);
}

function nextSourceVertex(vertex: ClipVertex): ClipVertex {
  let current = vertex.next;
  while (current.intersect) current = current.next;
  return current;
}

function insertIntersection(edgeStart: ClipVertex, vertex: ClipVertex): void {
  // Insert in alpha order between edgeStart and the next SOURCE vertex.
  let position = edgeStart;
  while (position.next.intersect && position.next.alpha < vertex.alpha) {
    position = position.next;
  }
  vertex.next = position.next;
  vertex.prev = position;
  position.next.prev = vertex;
  position.next = vertex;
}

function scanIntersections(subject: PolygonPoint[], clip: PolygonPoint[]): IntersectionScanResult {
  const subjectList = buildList(subject);
  const clipList = buildList(clip);
  let degenerate = false;
  let count = 0;

  const subjectVertices = [...iterateSourceVertices(subjectList)];
  const clipVertices = [...iterateSourceVertices(clipList)];

  for (const s0 of subjectVertices) {
    const s1 = nextSourceVertex(s0);
    for (const c0 of clipVertices) {
      const c1 = nextSourceVertex(c0);
      const dSx = s1.x - s0.x;
      const dSy = s1.y - s0.y;
      const dCx = c1.x - c0.x;
      const dCy = c1.y - c0.y;
      const denominator = dSx * dCy - dSy * dCx;
      const numeratorA = (c0.x - s0.x) * dCy - (c0.y - s0.y) * dCx;
      const numeratorB = (c0.x - s0.x) * dSy - (c0.y - s0.y) * dSx;

      if (Math.abs(denominator) < 1e-12) {
        // Parallel: collinear overlap is degenerate.
        if (Math.abs(numeratorA) < 1e-9 && segmentsOverlapCollinear(s0, s1, c0, c1)) {
          degenerate = true;
        }
        continue;
      }

      const alphaS = numeratorA / denominator;
      const alphaC = numeratorB / denominator;
      const EDGE_EPS = 1e-9;
      const inS = alphaS > EDGE_EPS && alphaS < 1 - EDGE_EPS;
      const inC = alphaC > EDGE_EPS && alphaC < 1 - EDGE_EPS;
      const onEndS = Math.abs(alphaS) <= EDGE_EPS || Math.abs(alphaS - 1) <= EDGE_EPS;
      const onEndC = Math.abs(alphaC) <= EDGE_EPS || Math.abs(alphaC - 1) <= EDGE_EPS;

      if ((onEndS && (inC || onEndC)) || (onEndC && inS)) {
        degenerate = true;
        continue;
      }
      if (!inS || !inC) continue;

      const x = s0.x + alphaS * dSx;
      const y = s0.y + alphaS * dSy;
      const subjectVertex: ClipVertex = {
        x, y, alpha: alphaS, intersect: true, entry: false, visited: false,
        neighbour: null, next: null as unknown as ClipVertex, prev: null as unknown as ClipVertex,
      };
      const clipVertex: ClipVertex = {
        x, y, alpha: alphaC, intersect: true, entry: false, visited: false,
        neighbour: null, next: null as unknown as ClipVertex, prev: null as unknown as ClipVertex,
      };
      subjectVertex.neighbour = clipVertex;
      clipVertex.neighbour = subjectVertex;
      insertIntersection(s0, subjectVertex);
      insertIntersection(c0, clipVertex);
      count += 1;
    }
  }

  return { degenerate, count, subjectList, clipList };
}

function segmentsOverlapCollinear(
  s0: PolygonPoint, s1: PolygonPoint, c0: PolygonPoint, c1: PolygonPoint,
): boolean {
  const horizontal = Math.abs(s1.x - s0.x) >= Math.abs(s1.y - s0.y);
  const project = (p: PolygonPoint) => (horizontal ? p.x : p.y);
  const sMin = Math.min(project(s0), project(s1));
  const sMax = Math.max(project(s0), project(s1));
  const cMin = Math.min(project(c0), project(c1));
  const cMax = Math.max(project(c0), project(c1));
  return sMax - cMin > 1e-9 && cMax - sMin > 1e-9;
}

function markEntries(list: ClipVertex, otherRing: PolygonPoint[], invert: boolean): void {
  let entry = !pointInsideRing({ x: list.x, y: list.y }, otherRing);
  if (invert) entry = !entry;
  let current = list;
  do {
    if (current.intersect) {
      current.entry = entry;
      entry = !entry;
    }
    current = current.next;
  } while (current !== list);
}

function traverse(subjectList: ClipVertex): PolygonPoint[][] {
  const rings: PolygonPoint[][] = [];
  for (;;) {
    let start: ClipVertex | null = null;
    let current = subjectList;
    do {
      if (current.intersect && !current.visited) {
        start = current;
        break;
      }
      current = current.next;
    } while (current !== subjectList);
    if (!start) break;

    const ring: PolygonPoint[] = [];
    let vertex: ClipVertex = start;
    do {
      vertex.visited = true;
      if (vertex.neighbour) vertex.neighbour.visited = true;
      if (vertex.entry) {
        do {
          ring.push({ x: vertex.x, y: vertex.y });
          vertex = vertex.next;
        } while (!vertex.intersect);
      } else {
        do {
          ring.push({ x: vertex.x, y: vertex.y });
          vertex = vertex.prev;
        } while (!vertex.intersect);
      }
      vertex.visited = true;
      vertex = vertex.neighbour as ClipVertex;
    } while (vertex !== start && vertex.neighbour !== start);

    const cleaned = dedupeRing(ring);
    if (cleaned.length >= 3 && Math.abs(polygonArea(cleaned)) > AREA_EPSILON) {
      rings.push(cleaned);
    }
  }
  return rings;
}

function noIntersectionResult(
  operation: Exclude<PolygonBooleanOperation, 'xor'>,
  subject: PolygonPoint[],
  clip: PolygonPoint[],
): PolygonClipResult {
  const subjectInClip = pointInsideRing(subject[0], clip);
  const clipInSubject = pointInsideRing(clip[0], subject);
  const copy = (ring: PolygonPoint[]) => ring.map((point) => ({ x: point.x, y: point.y }));

  if (operation === 'union') {
    if (subjectInClip) return { rings: [copy(clip)], approximate: false, containsHoles: false };
    if (clipInSubject) return { rings: [copy(subject)], approximate: false, containsHoles: false };
    return { rings: [copy(subject), copy(clip)], approximate: false, containsHoles: false };
  }
  if (operation === 'intersect') {
    if (subjectInClip) return { rings: [copy(subject)], approximate: false, containsHoles: false };
    if (clipInSubject) return { rings: [copy(clip)], approximate: false, containsHoles: false };
    return { rings: [], approximate: false, containsHoles: false };
  }
  // subtract
  if (subjectInClip) return { rings: [], approximate: false, containsHoles: false };
  if (clipInSubject) {
    return { rings: [copy(subject), copy(clip)], approximate: false, containsHoles: true };
  }
  return { rings: [copy(subject)], approximate: false, containsHoles: false };
}

function perturbRing(ring: PolygonPoint[], magnitude: number, salt: number): PolygonPoint[] {
  return ring.map((point, index) => {
    // Deterministic pseudo-random jitter (no Math.random: results must be stable for tests).
    const seed = Math.sin((index + 1) * 12.9898 * salt) * 43758.5453;
    const jitterA = (seed - Math.floor(seed)) - 0.5;
    const seedB = Math.sin((index + 7) * 78.233 * salt) * 12543.8567;
    const jitterB = (seedB - Math.floor(seedB)) - 0.5;
    return { x: point.x + jitterA * magnitude, y: point.y + jitterB * magnitude };
  });
}

function clipOnce(
  operation: Exclude<PolygonBooleanOperation, 'xor'>,
  subject: PolygonPoint[],
  clip: PolygonPoint[],
): PolygonClipResult {
  let workingClip = clip;
  let approximate = false;
  const diagonal = ringBoundsDiagonal([subject, clip]);

  for (let attempt = 0; attempt <= MAX_PERTURB_ATTEMPTS; attempt += 1) {
    const scan = scanIntersections(subject, workingClip);
    if (scan.degenerate) {
      approximate = true;
      workingClip = perturbRing(clip, diagonal * 1e-7 * 10 ** attempt, attempt + 1);
      continue;
    }
    if (scan.count === 0) {
      const result = noIntersectionResult(operation, subject, workingClip);
      return { ...result, approximate: approximate || result.approximate };
    }

    // Greiner–Hormann entry marking: intersect = plain, union = invert both,
    // subtract (A − B = A ∩ ¬B) = invert the SUBJECT side only (the subject is
    // traversed where it lies outside the clip; the clip is walked plain and
    // the backward-walk rule yields its inside-the-subject boundary).
    markEntries(scan.subjectList, workingClip, operation === 'union' || operation === 'subtract');
    markEntries(scan.clipList, subject, operation === 'union');

    const rings = traverse(scan.subjectList);
    return { rings, approximate, containsHoles: detectHoles(rings) };
  }

  throw new Error('Polygon boolean clipping could not resolve degenerate inputs.');
}

function detectHoles(rings: PolygonPoint[][]): boolean {
  if (rings.length < 2) return false;
  for (let i = 0; i < rings.length; i += 1) {
    for (let j = 0; j < rings.length; j += 1) {
      // Nested only when EVERY vertex sits inside the other ring — rings that
      // merely share boundary points (e.g. the two xor difference lobes) must
      // not read as holes, and a single-vertex test is fooled by shared corners.
      if (i !== j && rings[i].every((vertex) => pointInsideRing(vertex, rings[j]))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Boolean-clips two simple polygons (straight segments, no self-intersections).
 * `xor` is composed as (subject − clip) ∪ (clip − subject), which is exact for
 * disjoint difference parts.
 */
export function clipSimplePolygons(
  operation: PolygonBooleanOperation,
  subject: PolygonPoint[],
  clip: PolygonPoint[],
): PolygonClipResult {
  if (subject.length < 3 || clip.length < 3) {
    throw new Error('Polygon boolean clipping requires rings with at least three points.');
  }
  if (operation === 'xor') {
    const aMinusB = clipOnce('subtract', subject, clip);
    const bMinusA = clipOnce('subtract', clip, subject);
    const rings = [...aMinusB.rings, ...bMinusA.rings];
    return {
      rings,
      approximate: aMinusB.approximate || bMinusA.approximate,
      containsHoles: aMinusB.containsHoles || bMinusA.containsHoles || detectHoles(rings),
    };
  }
  return clipOnce(operation, subject, clip);
}
