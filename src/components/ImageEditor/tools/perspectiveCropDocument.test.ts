import { describe, expect, it } from 'vitest';
import { perspectiveCropOutputSize } from './perspectiveCropDocument';

describe('perspectiveCropOutputSize', () => {
  it('uses averaged opposite-edge lengths of the quad', () => {
    // Top edge 100, bottom edge 80 -> width 90; slanted sides hypot(10,60)=60.83 -> height 61.
    const quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 90, y: 60 },
      { x: 10, y: 60 },
    ];
    expect(perspectiveCropOutputSize(quad)).toEqual({ width: 90, height: 61 });

    // Vertical sides -> exact height.
    expect(perspectiveCropOutputSize([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ])).toEqual({ width: 100, height: 50 });
  });

  it('clamps to at least 1px and guards malformed quads', () => {
    expect(perspectiveCropOutputSize([{ x: 0, y: 0 }])).toEqual({ width: 1, height: 1 });
    expect(perspectiveCropOutputSize([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ])).toEqual({ width: 1, height: 1 });
  });
});
