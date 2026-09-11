import { describe, expect, it } from 'vitest';
import { resolveActiveBrushState } from './brushActiveState';
import { IMAGE_BRUSH_PRESETS, applyBrushPreset } from './ImageBrushPresets';
import { normalizeBrushSettings } from './ImageBrushEngine';

const firstPreset = IMAGE_BRUSH_PRESETS[0];
const cleanSettings = applyBrushPreset(normalizeBrushSettings({}), firstPreset);

describe('resolveActiveBrushState', () => {
  it('reports the active preset and not modified when settings match it', () => {
    const state = resolveActiveBrushState(cleanSettings, IMAGE_BRUSH_PRESETS);
    expect(state.activePresetId).toBe(firstPreset.id);
    expect(state.label).toBe(firstPreset.label);
    expect(state.modified).toBe(false);
  });

  it('reports modified when a property diverges from the active preset', () => {
    const edited = normalizeBrushSettings({ ...cleanSettings, size: cleanSettings.size + 17 });
    const state = resolveActiveBrushState(edited, IMAGE_BRUSH_PRESETS);
    expect(state.activePresetId).toBe(firstPreset.id);
    expect(state.modified).toBe(true);
  });

  it('falls back to Custom with no active id when presetId is absent', () => {
    const noId = normalizeBrushSettings({ ...cleanSettings, presetId: undefined });
    const state = resolveActiveBrushState(noId, IMAGE_BRUSH_PRESETS);
    expect(state.activePresetId).toBeNull();
    expect(state.label).toBe('Custom');
    expect(state.modified).toBe(false);
  });

  it('falls back to Custom when the active preset id no longer exists', () => {
    const ghost = normalizeBrushSettings({ ...cleanSettings, presetId: 'deleted-preset' });
    const state = resolveActiveBrushState(ghost, IMAGE_BRUSH_PRESETS);
    expect(state.activePresetId).toBeNull();
    expect(state.label).toBe('Custom');
  });
});
