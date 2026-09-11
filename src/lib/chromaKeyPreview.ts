import type { EditorClipChromaKeySettings } from '../types/flow';

export interface ChromaKeyImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

const RGB_DISTANCE_MAX = Math.sqrt(3 * 255 * 255);

export function applyChromaKeyToImageData<TImageData extends ChromaKeyImageDataLike>(
  imageData: TImageData,
  settings: EditorClipChromaKeySettings,
): TImageData {
  if (!settings.enabled) {
    return imageData;
  }

  const keyColor = parseChromaKeyColor(settings.color);
  const similarity = clampPercent(settings.similarityPercent) / 100;
  const blend = clampPercent(settings.blendPercent) / 100;
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const alphaScale = getChromaKeyAlphaScale(
      { red: data[index], green: data[index + 1], blue: data[index + 2] },
      keyColor,
      similarity,
      blend,
    );
    data[index + 3] = Math.round(data[index + 3] * alphaScale);
  }

  return imageData;
}

export function getChromaKeyAlphaScale(
  color: RgbColor,
  keyColor: RgbColor,
  similarity: number,
  blend: number,
): number {
  const distance = Math.sqrt(
    (color.red - keyColor.red) ** 2
    + (color.green - keyColor.green) ** 2
    + (color.blue - keyColor.blue) ** 2,
  ) / RGB_DISTANCE_MAX;

  if (distance <= similarity) {
    return 0;
  }

  if (blend <= 0) {
    return 1;
  }

  if (distance >= similarity + blend) {
    return 1;
  }

  return clampUnit((distance - similarity) / blend);
}

export function parseChromaKeyColor(value: string): RgbColor {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value : '#00ff00';

  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
