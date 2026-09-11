import { describe, expect, it } from 'vitest';
import { buildPaperTextArcPath } from './paperTextPath';

describe('buildPaperTextArcPath', () => {
  it('returns null for a straight (0%) baseline or a degenerate box', () => {
    expect(buildPaperTextArcPath(200, 100, 0)).toBeNull();
    expect(buildPaperTextArcPath(0, 100, 50)).toBeNull();
    expect(buildPaperTextArcPath(200, 0, 50)).toBeNull();
  });

  it('builds a symmetric quadratic arc spanning the box width', () => {
    const arc = buildPaperTextArcPath(200, 100, 50);
    expect(arc).not.toBeNull();
    expect(arc!.d).toMatch(/^M /);
    expect(arc!.d).toContain(' Q ');
    // endpoints inset symmetrically from each edge (inset = min(width*0.04, 8) = 8)
    expect(arc!.d.startsWith('M 8.00 ')).toBe(true);
    expect(arc!.d).toContain(' 192.00 '); // 200 - 8
  });

  it('arcs up for positive and down for negative curvature (control point flips)', () => {
    const up = buildPaperTextArcPath(200, 100, 60)!.d;
    const down = buildPaperTextArcPath(200, 100, -60)!.d;
    // control Y = mid(50) - amount*height*0.5 → up: 50 - 30 = 20; down: 50 + 30 = 80
    expect(up).toContain(' Q 100.00 20.00 ');
    expect(down).toContain(' Q 100.00 80.00 ');
  });

  it('clamps curvature beyond ±100%', () => {
    expect(buildPaperTextArcPath(200, 100, 500)!.d).toBe(buildPaperTextArcPath(200, 100, 100)!.d);
  });
});
