import type { EditorClipFilter } from '../types/flow';
import type { ProfessionalColorCorrection } from '../types/videoProfessional';

const PRIMARY_FILTER_IDS = new Set([
  // The former one-control Finish panel wrote this id. Treating it as owned prevents a legacy
  // brightness correction from stacking with the replacement primary projection on first edit.
  'professional-color-exposure',
  'professional-primary-exposure',
  'professional-primary-contrast',
  'professional-primary-saturation',
]);

export interface PrimaryColorCorrectionPatch {
  color: ProfessionalColorCorrection;
  filterStack: EditorClipFilter[];
}

export type PrimaryColorCorrectionInput = Partial<Pick<
  ProfessionalColorCorrection,
  'exposureStops' | 'contrast' | 'saturation'
>>;

/**
 * Keeps the executable primary controls in one saved record while projecting the supported channels
 * into the pre-existing clip-effect chain used by the Program Monitor, stage-frame renderer, and
 * FFmpeg sequence path. Temperature/tint/lift/gamma/gain remain retained setup metadata here: there
 * is deliberately no second, preview-only color renderer for values the delivery chain cannot honor.
 */
export function buildPrimaryColorCorrectionPatch(
  filters: readonly EditorClipFilter[],
  current: Partial<ProfessionalColorCorrection> | undefined,
  input: PrimaryColorCorrectionInput,
): PrimaryColorCorrectionPatch {
  const color = normalizePrimaryColorCorrection({ ...current, ...input });
  const filterStack = filters.filter((filter) => !PRIMARY_FILTER_IDS.has(filter.id));

  const primaryCandidates: EditorClipFilter[] = [
    { id: 'professional-primary-exposure', kind: 'brightness', amount: Math.round(color.exposureStops * 10), enabled: true },
    { id: 'professional-primary-contrast', kind: 'contrast', amount: color.contrast, enabled: true },
    { id: 'professional-primary-saturation', kind: 'saturation', amount: color.saturation - 100, enabled: true },
  ];
  const primaryFilters = primaryCandidates.filter((filter) => filter.amount !== 0);

  return { color, filterStack: [...filterStack, ...primaryFilters] };
}

export function resetPrimaryColorCorrection(
  filters: readonly EditorClipFilter[],
  current: Partial<ProfessionalColorCorrection> | undefined,
): PrimaryColorCorrectionPatch {
  return buildPrimaryColorCorrectionPatch(filters, current, {
    exposureStops: 0,
    contrast: 0,
    saturation: 100,
  });
}

export function hasPrimaryColorCorrection(color: Partial<ProfessionalColorCorrection> | undefined): boolean {
  const normalized = normalizePrimaryColorCorrection(color);
  return normalized.exposureStops !== 0 || normalized.contrast !== 0 || normalized.saturation !== 100;
}

function normalizePrimaryColorCorrection(value: Partial<ProfessionalColorCorrection> | undefined): ProfessionalColorCorrection {
  const tuple = (candidate: unknown): [number, number, number] => {
    const entries = Array.isArray(candidate) ? candidate : [];
    return [0, 1, 2].map((index) => clamp(entries[index], -2, 2, 0)) as [number, number, number];
  };

  return {
    exposureStops: clamp(value?.exposureStops, -10, 10, 0),
    contrast: clamp(value?.contrast, -100, 100, 0),
    temperature: clamp(value?.temperature, -100, 100, 0),
    tint: clamp(value?.tint, -100, 100, 0),
    saturation: clamp(value?.saturation, 0, 200, 100),
    lift: tuple(value?.lift),
    gamma: tuple(value?.gamma),
    gain: tuple(value?.gain),
    ...(typeof value?.inputLutName === 'string' && value.inputLutName.trim()
      ? { inputLutName: value.inputLutName.trim().slice(0, 256) }
      : {}),
  };
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(numberValue * 100) / 100));
}
