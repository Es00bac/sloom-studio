import type { CropAspectPreset } from '../../types/imageEditor';

/**
 * Custom crop aspect-ratio presets — the user-managed half of the Crop tool's
 * preset library (the built-in `free`/`original`/`1:1`/… live in the
 * `CropAspectPreset` union). A custom preset is applied by setting the crop
 * tool's `aspectPreset` to the encoded `custom:<ratio>` value, so the ratio
 * flows through the existing resolver functions without threading a new field.
 */
export interface CropCustomPreset {
  id: string;
  label: string;
  /** width / height, always a finite positive number. */
  ratio: number;
}

export const CROP_CUSTOM_PRESET_PREFIX = 'custom:';

/** Round a ratio for a stable, compact encoded value / signature. */
function roundRatio(ratio: number): number {
  return Math.round(ratio * 10000) / 10000;
}

/** Encode a ratio as the `custom:<ratio>` aspect-preset value. */
export function cropCustomPresetValue(ratio: number): CropAspectPreset {
  return `${CROP_CUSTOM_PRESET_PREFIX}${roundRatio(ratio)}` as CropAspectPreset;
}

/** Decode a `custom:<ratio>` aspect-preset value to its ratio, else null. */
export function parseCropCustomPresetRatio(preset: string): number | null {
  if (!preset.startsWith(CROP_CUSTOM_PRESET_PREFIX)) return null;
  const ratio = Number.parseFloat(preset.slice(CROP_CUSTOM_PRESET_PREFIX.length));
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * Parse a user-entered ratio: "16:9", "4x5", "4 × 5", or a decimal like "1.85".
 * Returns a positive width/height ratio, or null when it can't be understood.
 */
export function parseCropRatioInput(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s*[:x×]\s*/i);
  if (parts.length === 2) {
    const w = Number.parseFloat(parts[0]);
    const h = Number.parseFloat(parts[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return roundRatio(w / h);
    return null;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) && value > 0 ? roundRatio(value) : null;
}

/** Human label for a ratio, e.g. 1.7778 -> "1.78:1". */
export function formatCropRatioLabel(ratio: number): string {
  return `${roundRatio(ratio)}:1`;
}

function nextCropPresetId(existingIds: string[]): string {
  let index = existingIds.length + 1;
  let candidate = `crop-preset-${index}`;
  const taken = new Set(existingIds);
  while (taken.has(candidate)) {
    index += 1;
    candidate = `crop-preset-${index}`;
  }
  return candidate;
}

/** Create a custom preset with a unique id; falls back to a ratio label. */
export function createCropPreset(label: string, ratio: number, existingIds: string[]): CropCustomPreset {
  const trimmed = label.trim();
  return {
    id: nextCropPresetId(existingIds),
    label: trimmed || formatCropRatioLabel(ratio),
    ratio: roundRatio(ratio),
  };
}

export function renameCropPreset(preset: CropCustomPreset, label: string): CropCustomPreset {
  const trimmed = label.trim();
  return { ...preset, label: trimmed || preset.label };
}

/** Drop malformed entries from persisted/imported preset lists. */
export function sanitizeCropPresets(value: unknown): CropCustomPreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CropCustomPreset[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<CropCustomPreset>;
    if (typeof candidate.id !== 'string' || seen.has(candidate.id)) continue;
    if (typeof candidate.ratio !== 'number' || !Number.isFinite(candidate.ratio) || candidate.ratio <= 0) continue;
    seen.add(candidate.id);
    out.push({
      id: candidate.id,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label : formatCropRatioLabel(candidate.ratio),
      ratio: roundRatio(candidate.ratio),
    });
  }
  return out;
}
