import { describe, expect, it } from 'vitest';
import { buildDoodleAssetPackage, doodleCanvasDimensions } from './doodleNode';

describe('buildDoodleAssetPackage', () => {
  it('packages the sketch image and the typed description when no text node is attached', () => {
    expect(buildDoodleAssetPackage({ sketch: 'data:image/png;base64,abc', ownDescription: 'a fox' }))
      .toEqual({ image: 'data:image/png;base64,abc', description: 'a fox' });
  });

  it('lets an attached Text node override the typed description', () => {
    expect(buildDoodleAssetPackage({ sketch: 'data:image/png;base64,abc', ownDescription: 'typed', upstreamText: 'from text node' }))
      .toEqual({ image: 'data:image/png;base64,abc', description: 'from text node' });
  });

  it('falls back to the typed box when the attached text is blank', () => {
    expect(buildDoodleAssetPackage({ ownDescription: 'typed', upstreamText: '   ' }).description).toBe('typed');
  });

  it('reports a null image until something is drawn', () => {
    expect(buildDoodleAssetPackage({ ownDescription: 'a fox' }).image).toBeNull();
    expect(buildDoodleAssetPackage({ sketch: '   ', ownDescription: 'a fox' }).image).toBeNull();
  });
});

describe('doodleCanvasDimensions', () => {
  it('keeps a square at the base size', () => {
    expect(doodleCanvasDimensions('1:1', 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it('fits landscape and portrait ratios within the base square', () => {
    expect(doodleCanvasDimensions('16:9', 1024)).toEqual({ width: 1024, height: 576 });
    expect(doodleCanvasDimensions('9:16', 1024)).toEqual({ width: 576, height: 1024 });
    expect(doodleCanvasDimensions('3:2', 600)).toEqual({ width: 600, height: 400 });
  });
});
