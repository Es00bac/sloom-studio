import { describe, expect, it } from 'vitest';
import { drawFilledEllipseOnImageData, drawFilledRectOnImageData, drawVectorPathOnImageData } from './ImageShapeDraw';

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function getPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const offset = (y * imageData.width + x) * 4;
  return [
    imageData.data[offset],
    imageData.data[offset + 1],
    imageData.data[offset + 2],
    imageData.data[offset + 3],
  ];
}

describe('ImageShapeDraw', () => {
  it('draws a filled rectangle into the requested bounds', () => {
    const imageData = makeImageData(4, 3);

    const drawn = drawFilledRectOnImageData(imageData, {
      from: { x: 1, y: 1 },
      to: { x: 3, y: 3 },
      color: '#ff0000',
      opacity: 1,
    });

    expect(getPixel(drawn, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(drawn, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(getPixel(drawn, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('draws a filled ellipse inside the requested bounds', () => {
    const imageData = makeImageData(6, 6);

    const drawn = drawFilledEllipseOnImageData(imageData, {
      from: { x: 1, y: 1 },
      to: { x: 5, y: 5 },
      color: '#00ff00',
      opacity: 1,
    });

    expect(getPixel(drawn, 3, 3)).toEqual([0, 255, 0, 255]);
    expect(getPixel(drawn, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('draws open vector paths as stroke-only while retaining closed path fill and stroke order', () => {
    const lineSource = makeImageData(6, 3);

    const line = drawVectorPathOnImageData(lineSource, {
      points: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
      ],
      closed: false,
      fillColor: '#00ff00',
      fillOpacity: 1,
      strokeColor: '#ff0000',
      strokeOpacity: 1,
      strokeWidth: 1,
    });

    expect(getPixel(line, 2, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(line, 2, 0)).toEqual([0, 0, 0, 0]);

    const closedSource = makeImageData(5, 5);
    const closed = drawVectorPathOnImageData(closedSource, {
      points: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 4 },
        { x: 1, y: 4 },
      ],
      closed: true,
      fillColor: '#00ff00',
      fillOpacity: 1,
      strokeColor: '#0000ff',
      strokeOpacity: 1,
      strokeWidth: 1,
    });

    expect(getPixel(closed, 2, 2)).toEqual([0, 255, 0, 255]);
    expect(getPixel(closed, 1, 1)).toEqual([0, 0, 255, 255]);
  });
});
