/**
 * Sloom Studio (GPL) — physical-media preset catalog seam. The Tiltmark preset library is part
 * of the proprietary engine and is not shipped here, so the catalog is empty and the Image
 * workspace offers only the built-in Studio brush engine.
 */
import type { BrushSettings } from '../../../types/imageEditor';
import type { TiltmarkBrushPreset } from './TiltmarkTypes';

export const TILTMARK_BRUSH_PRESETS: readonly TiltmarkBrushPreset[] = [];
export const TILTMARK_BRUSH_CATEGORIES: readonly string[] = [];

const ABSENT_PRESET: TiltmarkBrushPreset = {
  id: 'engine-absent', name: 'Physical media (not included)', category: 'Unavailable',
  description: 'The physical-media brush engine is not included in this build of Sloom Studio.',
  medium: 'none', tip: { kind: 'round' }, color: '#000000', sizePx: 12, opacity: 1, flow: 1, hardness: 0.5,
  spacing: 0.1, smoothing: 0, pressureCurve: 'linear', pressureSize: 0, pressureOpacity: 0, pressureFlow: 0,
  pressureColor: 0, tiltSize: 0, tiltOpacity: 0, tiltColor: 0, wetness: 0, solvent: 0, interaction: 'paint',
  eraser: false, pickup: 0, paintLoad: 0, vehicleLoad: 0, pigmentRefillRatio: 0, vehicleRefillRatio: 0,
  loadFalloff: 0, grain: 0, scatter: 0, sizeJitter: 0, opacityJitter: 0, angleJitter: 0,
};

export function getTiltmarkBrushPreset(_id: string | null | undefined): TiltmarkBrushPreset { return ABSENT_PRESET; }
export function getTiltmarkBrushesInCategory(_category: string): readonly TiltmarkBrushPreset[] { return []; }
export function applyTiltmarkBrushPreset(settings: Partial<BrushSettings>, _preset: TiltmarkBrushPreset): BrushSettings { return settings as BrushSettings; }
export function describeTiltmarkTip(_preset: TiltmarkBrushPreset): string { return 'Physical-media engine not included'; }
