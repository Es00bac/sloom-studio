import { describe, expect, it } from 'vitest';
import { VERTEX_REGIONS, VERTEX_REGION_CUSTOM_VALUE, isKnownVertexRegion } from './vertexRegions';

describe('vertexRegions', () => {
  it('exposes a non-empty list with unique, well-formed entries', () => {
    expect(VERTEX_REGIONS.length).toBeGreaterThan(5);
    const values = VERTEX_REGIONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
    for (const region of VERTEX_REGIONS) {
      expect(region.value).toBeTruthy();
      expect(region.label).toBeTruthy();
    }
  });

  it('includes global and us-central1', () => {
    expect(isKnownVertexRegion('global')).toBe(true);
    expect(isKnownVertexRegion('us-central1')).toBe(true);
    expect(isKnownVertexRegion('not-a-region')).toBe(false);
  });

  it('reserves a sentinel for custom entry distinct from real regions', () => {
    expect(isKnownVertexRegion(VERTEX_REGION_CUSTOM_VALUE)).toBe(false);
  });
});
