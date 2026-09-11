import type { BrushSettings } from '../../types/imageEditor';
import { applyBrushPreset, type ImageBrushPreset } from './ImageBrushPresets';

export interface ActiveBrushState {
  activePresetId: string | null;
  label: string;
  modified: boolean;
}

// The brush-shape fields a preset controls; "modified" compares only these so unrelated
// transient settings (e.g. live color) don't spuriously mark the brush dirty.
const COMPARED_FIELDS: Array<keyof BrushSettings> = [
  'size', 'opacity', 'hardness', 'flow', 'spacing', 'roundness', 'angleDeg', 'scatter',
  'smoothing', 'symmetryMode', 'tipShape', 'pressureSize', 'pressureOpacity', 'pressureFlow',
  'velocitySize', 'velocityOpacity', 'velocityFlow', 'velocitySpacing', 'texture', 'textureScale',
  'textureDepth', 'dualBrush', 'wetMedia', 'wetEdges', 'wetMix', 'wetLoad', 'wetPull',
];

/**
 * Resolves which preset a brush is "based on" and whether the live settings have diverged
 * from that preset. `modified` is derived (not a stored flag) by re-applying the preset to the
 * current settings and comparing the brush-shape fields — so it can never go stale.
 */
export function resolveActiveBrushState(
  settings: BrushSettings,
  presets: readonly ImageBrushPreset[],
): ActiveBrushState {
  const presetId = settings.presetId;
  const preset = presetId ? presets.find((candidate) => candidate.id === presetId) : undefined;
  if (!preset) {
    return { activePresetId: null, label: 'Custom', modified: false };
  }

  const baseline = applyBrushPreset(settings, preset);
  const modified = COMPARED_FIELDS.some((field) => settings[field] !== baseline[field]);
  return { activePresetId: preset.id, label: preset.label, modified };
}
