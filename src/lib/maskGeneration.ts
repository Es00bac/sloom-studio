export function generateBinaryMask(
  selectionData: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < selectionData.length; i += 4) {
    const isSelected = selectionData[i + 3] > 128;
    imageData.data[i] = isSelected ? 255 : 0;
    imageData.data[i + 1] = isSelected ? 255 : 0;
    imageData.data[i + 2] = isSelected ? 255 : 0;
    imageData.data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function generateFeatheredMask(
  selectionData: Uint8ClampedArray,
  width: number,
  height: number,
  featherRadius: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);

  const alphaMap = new Float32Array(width * height);
  for (let i = 0; i < selectionData.length; i += 4) {
    alphaMap[i / 4] = selectionData[i + 3] / 255;
  }

  const feathered = boxBlurAlpha(alphaMap, width, height, featherRadius);

  for (let i = 0; i < feathered.length; i++) {
    const v = Math.round(feathered[i] * 255);
    const di = i * 4;
    imageData.data[di] = v;
    imageData.data[di + 1] = v;
    imageData.data[di + 2] = v;
    imageData.data[di + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function boxBlurAlpha(
  data: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const result = new Float32Array(data.length);
  const size = radius * 2 + 1;
  const area = size * size;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const sy = Math.min(height - 1, Math.max(0, y + ky));
          const sx = Math.min(width - 1, Math.max(0, x + kx));
          sum += data[sy * width + sx];
        }
      }
      result[y * width + x] = sum / area;
    }
  }

  return result;
}
