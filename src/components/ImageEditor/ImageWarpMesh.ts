/**
 * Photoshop-style warp mesh: an (columns+1)×(rows+1) grid of control-point displacements
 * (normalized as a fraction of the layer's width/height) that deforms a layer. Pure +
 * tested; the renderer (drawLayerBitmapTransformed) subdivides the layer and samples this
 * mesh per grid node, and the on-canvas overlay drags the control points.
 *
 * Displacement is sampled with Catmull-Rom (cubic) interpolation across the grid so a
 * coarse control mesh still produces a smooth deformation.
 */

import type { WarpMesh, WarpMeshPoint } from '../../types/imageEditor';

export type { WarpMesh, WarpMeshPoint } from '../../types/imageEditor';

export type WarpMeshPreset =
  | 'none'
  | 'arc'
  | 'arcLower'
  | 'arcUpper'
  | 'flag'
  | 'wave'
  | 'bulge'
  | 'fisheye'
  | 'twist';

export const DEFAULT_WARP_MESH_COLUMNS = 3;
export const DEFAULT_WARP_MESH_ROWS = 3;

export function warpMeshNodeIndex(mesh: { columns: number }, column: number, row: number): number {
  return row * (mesh.columns + 1) + column;
}

export function createIdentityWarpMesh(
  columns: number = DEFAULT_WARP_MESH_COLUMNS,
  rows: number = DEFAULT_WARP_MESH_ROWS,
): WarpMesh {
  const cols = Math.max(1, Math.round(columns));
  const rws = Math.max(1, Math.round(rows));
  const count = (cols + 1) * (rws + 1);
  const points: WarpMeshPoint[] = new Array(count);
  for (let i = 0; i < count; i += 1) points[i] = { x: 0, y: 0 };
  return { columns: cols, rows: rws, points };
}

function clampNumber(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  // Bound displacements to ±2 layer-widths to keep buffers/handles sane.
  return value < -2 ? -2 : value > 2 ? 2 : value;
}

/**
 * Coerces an arbitrary value into a valid mesh (defensive for imported/persisted data).
 *
 * Self-contained (no external function references) so it can be stringified into the
 * composite-render Web Worker alongside `getImageLayerBitmapDrawMetrics`, which calls it
 * for every drawn layer. A stray reference here crashes the whole worker render.
 */
export function normalizeWarpMesh(mesh: WarpMesh | null | undefined): WarpMesh | null {
  if (!mesh) return null;
  // Inlined clamp (kept local so this function carries no external reference into the worker).
  // Bounds displacements to ±2 layer-widths, matching the module-level helper used elsewhere.
  const clampDisplacement = (value: number | undefined): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return value < -2 ? -2 : value > 2 ? 2 : value;
  };
  const cols = Math.max(1, Math.round(mesh.columns));
  const rws = Math.max(1, Math.round(mesh.rows));
  const count = (cols + 1) * (rws + 1);
  const points: WarpMeshPoint[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const p = mesh.points?.[i];
    points[i] = { x: clampDisplacement(p?.x), y: clampDisplacement(p?.y) };
  }
  return { columns: cols, rows: rws, points };
}

export function isWarpMeshDeformed(mesh: WarpMesh | null | undefined): boolean {
  if (!mesh || !mesh.points) return false;
  for (let i = 0; i < mesh.points.length; i += 1) {
    const p = mesh.points[i];
    if (Math.abs(p.x) > 1e-4 || Math.abs(p.y) > 1e-4) return true;
  }
  return false;
}

/**
 * Samples the normalized warp displacement at (u, v) ∈ [0,1]² using separable Catmull-Rom
 * interpolation of the control-point grid. Returns {x, y} normalized to layer width/height.
 *
 * Self-contained (no external function references) so it can be stringified into the
 * composite-render Web Worker alongside `transformSourcePoint`.
 */
export function sampleWarpMeshDisplacement(mesh: WarpMesh, u: number, v: number): WarpMeshPoint {
  const cols = mesh.columns;
  const rows = mesh.rows;
  const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
  const node = (c: number, r: number): WarpMeshPoint => {
    const cc = c < 0 ? 0 : c > cols ? cols : c;
    const rr = r < 0 ? 0 : r > rows ? rows : r;
    return mesh.points[rr * (cols + 1) + cc] ?? { x: 0, y: 0 };
  };
  const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const gx = clamp01(u) * cols;
  const gy = clamp01(v) * rows;
  const cx = Math.min(cols - 1, Math.floor(gx));
  const cy = Math.min(rows - 1, Math.floor(gy));
  const tx = gx - cx;
  const ty = gy - cy;
  const rowX: number[] = [];
  const rowY: number[] = [];
  for (let j = -1; j <= 2; j += 1) {
    const r = cy + j;
    rowX.push(catmullRom(node(cx - 1, r).x, node(cx, r).x, node(cx + 1, r).x, node(cx + 2, r).x, tx));
    rowY.push(catmullRom(node(cx - 1, r).y, node(cx, r).y, node(cx + 1, r).y, node(cx + 2, r).y, tx));
  }
  return {
    x: catmullRom(rowX[0], rowX[1], rowX[2], rowX[3], ty),
    y: catmullRom(rowY[0], rowY[1], rowY[2], rowY[3], ty),
  };
}

/**
 * Builds a warp mesh from a per-node displacement function of (u, v) ∈ [0,1]². Used to
 * generate the built-in presets and reusable for custom generators.
 */
export function buildWarpMeshFromFunction(
  columns: number,
  rows: number,
  fn: (u: number, v: number) => WarpMeshPoint,
): WarpMesh {
  const mesh = createIdentityWarpMesh(columns, rows);
  for (let r = 0; r <= mesh.rows; r += 1) {
    for (let c = 0; c <= mesh.columns; c += 1) {
      const u = c / mesh.columns;
      const v = r / mesh.rows;
      const d = fn(u, v);
      mesh.points[warpMeshNodeIndex(mesh, c, r)] = { x: clampNumber(d.x), y: clampNumber(d.y) };
    }
  }
  return mesh;
}

/**
 * Generates a built-in warp preset (Photoshop-style) at a normalized `intensity`
 * (1 = a natural full-strength deformation). Returns an identity mesh for 'none'.
 */
export function createWarpMeshPreset(
  preset: WarpMeshPreset,
  intensity = 1,
  columns: number = DEFAULT_WARP_MESH_COLUMNS,
  rows: number = DEFAULT_WARP_MESH_ROWS,
): WarpMesh {
  const k = intensity;
  switch (preset) {
    case 'arc':
      // Whole shape bows along a single arc (top + bottom rise together).
      return buildWarpMeshFromFunction(columns, rows, (u) => ({ x: 0, y: -0.25 * k * Math.sin(Math.PI * u) }));
    case 'arcUpper':
      // Only the top edge curves up; bottom edge stays put.
      return buildWarpMeshFromFunction(columns, rows, (u, v) => ({ x: 0, y: -0.3 * k * Math.sin(Math.PI * u) * (1 - v) }));
    case 'arcLower':
      return buildWarpMeshFromFunction(columns, rows, (u, v) => ({ x: 0, y: 0.3 * k * Math.sin(Math.PI * u) * v }));
    case 'flag':
      return buildWarpMeshFromFunction(columns, rows, (u) => ({ x: 0, y: 0.18 * k * Math.sin(2 * Math.PI * u) }));
    case 'wave':
      return buildWarpMeshFromFunction(columns, rows, (u, v) => ({
        x: 0.08 * k * Math.sin(2 * Math.PI * v),
        y: 0.18 * k * Math.sin(2 * Math.PI * u),
      }));
    case 'bulge':
      return buildWarpMeshFromFunction(columns, rows, (u, v) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const falloff = Math.max(0, 1 - Math.hypot(dx, dy) * 2);
        return { x: dx * 0.6 * k * falloff, y: dy * 0.6 * k * falloff };
      });
    case 'fisheye':
      return buildWarpMeshFromFunction(columns, rows, (u, v) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.hypot(dx, dy);
        const pull = -0.5 * k * (1 - Math.min(1, r * 2));
        return { x: dx * pull, y: dy * pull };
      });
    case 'twist':
      return buildWarpMeshFromFunction(columns, rows, (u, v) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.hypot(dx, dy);
        const angle = (1 - Math.min(1, r * 2)) * k * 1.2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return { x: dx * cos - dy * sin - dx, y: dx * sin + dy * cos - dy };
      });
    case 'none':
    default:
      return createIdentityWarpMesh(columns, rows);
  }
}
