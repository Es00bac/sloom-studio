import { describe, expect, it } from 'vitest';
import { smudgeRegion, blurRegion, sharpenRegion } from './cpuKernels';

function imageData(width: number, height: number, fill: (i: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set(fill(i), i * 4);
  }
  return { width, height, data } as ImageData;
}

describe('cpuKernels', () => {
  it('smudgeRegion pulls the drag-origin colour into the target, only inside the rect', () => {
    // x0,x1 dark; x2,x3 light. Drag from a dark pixel (x1) toward a light pixel (x2).
    const target = imageData(4, 1, (i) => (i < 2 ? [0, 0, 0, 255] : [200, 200, 200, 255]));
    const source = imageData(4, 1, (i) => (i < 2 ? [0, 0, 0, 255] : [200, 200, 200, 255]));
    smudgeRegion(target, source, {
      from: { x: 1, y: 0 }, to: { x: 2, y: 0 }, size: 2, strength: 1,
      rect: { x: 1, y: 0, width: 2, height: 1 },
    });
    expect(target.data[0]).toBe(0);            // x0 outside rect untouched
    expect(target.data[2 * 4]).toBeLessThan(200); // x2 pulled toward the dark origin
  });

  it('blurRegion averages neighbours, leaving outside-rect pixels unchanged', () => {
    const target = imageData(3, 1, (i) => (i === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const source = imageData(3, 1, (i) => (i === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const before0 = target.data[0];
    blurRegion(target, source, { to: { x: 1, y: 0 }, size: 3, strength: 1, rect: { x: 1, y: 0, width: 1, height: 1 } });
    expect(target.data[0]).toBe(before0);          // outside rect untouched
    expect(target.data[1 * 4]).toBeGreaterThan(0); // center blurred toward white
  });

  it('sharpenRegion increases center contrast inside the rect', () => {
    const target = imageData(3, 1, (i) => (i === 1 ? [120, 120, 120, 255] : [110, 110, 110, 255]));
    const source = imageData(3, 1, (i) => (i === 1 ? [120, 120, 120, 255] : [110, 110, 110, 255]));
    sharpenRegion(target, source, { to: { x: 1, y: 0 }, size: 3, strength: 1, rect: { x: 1, y: 0, width: 1, height: 1 } });
    expect(target.data[1 * 4]).toBeGreaterThanOrEqual(120);
  });
});
