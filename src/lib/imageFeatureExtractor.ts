export interface ImageFeatureMetadata {
  width: number;
  height: number;
  aspectRatio: number;
  orientation: 'square' | 'landscape' | 'portrait';
  averageColor?: string;
  mimeType?: string;
}

export function summarizeImagePixels(input: {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  mimeType?: string;
}): ImageFeatureMetadata {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alphaTotal = 0;
  for (let index = 0; index + 3 < input.rgba.length; index += 4) {
    const alpha = input.rgba[index + 3] / 255;
    if (alpha === 0) continue;
    red += input.rgba[index] * alpha;
    green += input.rgba[index + 1] * alpha;
    blue += input.rgba[index + 2] * alpha;
    alphaTotal += alpha;
  }

  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(alphaTotal ? value / alphaTotal : 0)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  const aspectRatio = input.height > 0 ? Number((input.width / input.height).toFixed(4)) : 0;
  const orientation = input.width === input.height ? 'square' : input.width > input.height ? 'landscape' : 'portrait';

  return {
    width: input.width,
    height: input.height,
    aspectRatio,
    orientation,
    averageColor: `#${channel(red)}${channel(green)}${channel(blue)}`,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
  };
}
