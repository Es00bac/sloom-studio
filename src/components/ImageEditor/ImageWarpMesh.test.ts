import { describe, expect, it } from 'vitest';
import {
  createIdentityWarpMesh,
  sampleWarpMeshDisplacement,
  isWarpMeshDeformed,
  normalizeWarpMesh,
  createWarpMeshPreset,
  warpMeshNodeIndex,
} from './ImageWarpMesh';

describe('ImageWarpMesh', () => {
  it('creates an identity mesh of the right size with zero displacement', () => {
    const mesh = createIdentityWarpMesh(3, 3);
    expect(mesh.columns).toBe(3);
    expect(mesh.rows).toBe(3);
    expect(mesh.points).toHaveLength(16); // (3+1)*(3+1)
    expect(isWarpMeshDeformed(mesh)).toBe(false);
    const d = sampleWarpMeshDisplacement(mesh, 0.5, 0.5);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(0, 6);
  });

  it('interpolates a moved control point smoothly', () => {
    const mesh = createIdentityWarpMesh(2, 2); // 3x3 nodes
    // Push the center node (1,1) down by 0.2 of height.
    mesh.points[warpMeshNodeIndex(mesh, 1, 1)] = { x: 0, y: 0.2 };
    expect(isWarpMeshDeformed(mesh)).toBe(true);
    // At the exact center node the displacement equals the node value.
    const center = sampleWarpMeshDisplacement(mesh, 0.5, 0.5);
    expect(center.y).toBeCloseTo(0.2, 5);
    // Corners are pinned (their nodes are zero) so displacement there is ~0.
    expect(Math.abs(sampleWarpMeshDisplacement(mesh, 0, 0).y)).toBeLessThan(1e-3);
    // A point between center and edge is partially displaced.
    const mid = sampleWarpMeshDisplacement(mesh, 0.75, 0.5);
    expect(mid.y).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(0.2);
  });

  it('normalizes/clamps imported mesh data defensively', () => {
    const dirty = { columns: 2, rows: 2, points: [{ x: 99, y: NaN }] } as never;
    const mesh = normalizeWarpMesh(dirty)!;
    expect(mesh.points).toHaveLength(9);
    expect(mesh.points[0].x).toBe(2); // clamped to ±2
    expect(mesh.points[0].y).toBe(0); // NaN -> 0
    expect(mesh.points[8]).toEqual({ x: 0, y: 0 }); // missing -> identity
  });

  it('normalizeWarpMesh is self-contained so it survives stringification into the composite worker', () => {
    // getImageLayerBitmapDrawMetrics() calls normalizeWarpMesh(), and that metrics function is
    // serialised with .toString() into the composite-render Web Worker. If normalizeWarpMesh
    // references any module-level helper (it used to call `clampNumber`), the worker throws
    // "X is not defined" on EVERY drawn layer — which silently broke the Type tool, because a
    // placed text layer renders through the transformed draw path. Guard against regressing that.
    const src = normalizeWarpMesh.toString();
    expect(src).not.toMatch(/clampNumber\s*\(/); // must not CALL the module-level helper
    // Rebuild it with no surrounding scope (exactly the worker's situation) and confirm it runs.
    const isolated = new Function(`return (${src});`)() as typeof normalizeWarpMesh;
    const out = isolated({ columns: 2, rows: 2, points: [{ x: 99, y: NaN }] } as never)!;
    expect(out.points).toHaveLength(9);
    expect(out.points[0]).toEqual({ x: 2, y: 0 }); // clamp to ±2 + NaN -> 0, still applied
  });

  it('generates deforming presets and an identity for none', () => {
    expect(isWarpMeshDeformed(createWarpMeshPreset('none'))).toBe(false);
    for (const preset of ['arc', 'arcUpper', 'arcLower', 'flag', 'wave', 'bulge', 'fisheye', 'twist'] as const) {
      expect(isWarpMeshDeformed(createWarpMeshPreset(preset, 1))).toBe(true);
    }
  });

  it('arc preset bows the middle and pins the left/right edges', () => {
    const arc = createWarpMeshPreset('arc', 1);
    const edge = sampleWarpMeshDisplacement(arc, 0, 0.5);
    const middle = sampleWarpMeshDisplacement(arc, 0.5, 0.5);
    expect(Math.abs(edge.y)).toBeLessThan(1e-3);
    expect(middle.y).toBeLessThan(-0.1); // bowed upward (negative Y)
  });
});
