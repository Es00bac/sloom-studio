// Built-in brush textures.
//
// The brush engine modulates each dab's painted alpha by a per-dab "texture
// value" in [0,1] (see paintBrushDab → globalAlpha). Historically the texture
// *name* was ignored — every texture produced the same seeded noise. These
// presets give each named texture a distinct procedural character so the
// selector actually changes how a stroke is grained.

export interface BrushTexturePreset {
  /** Stored in BrushSettings.texture. */
  readonly id: string;
  /** Shown in the brush-properties picker. */
  readonly label: string;
}

export const BRUSH_TEXTURE_PRESETS: readonly BrushTexturePreset[] = [
  { id: 'canvas-grain', label: 'Canvas Grain' },
  { id: 'fine-grain', label: 'Fine Grain' },
  { id: 'chalk', label: 'Chalk' },
  { id: 'spatter', label: 'Spatter' },
  { id: 'hatch', label: 'Hatch' },
  { id: 'dots', label: 'Halftone Dots' },
] as const;

export const DEFAULT_BRUSH_TEXTURE_ID = 'canvas-grain';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Deterministic value-noise in [0,1). */
function textureNoise(seed: number, index: number): number {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function isBuiltInBrushTexture(id: string | undefined | null): boolean {
  return Boolean(id) && BRUSH_TEXTURE_PRESETS.some((preset) => preset.id === id);
}

/** Resolve any stored texture id to a known preset id, defaulting unknown/custom ids. */
export function resolveBrushTextureId(id: string | undefined | null): string {
  return isBuiltInBrushTexture(id) ? (id as string) : DEFAULT_BRUSH_TEXTURE_ID;
}

/**
 * Per-dab texture value in [0,1]. Each named texture shapes the modulation
 * differently so the selected texture visibly changes the stroke. `scale`
 * stretches the texture's spatial frequency along the stroke (higher scale →
 * coarser pattern); `dual` blends a second noise octave (dual-brush).
 */
export function sampleBrushTexture(
  textureId: string | undefined | null,
  seed: number,
  index: number,
  scale: number,
  dual: boolean,
): number {
  const freq = clamp(scale, 0.05, 4);
  const phase = index / freq;
  const base = textureNoise(seed + Math.round(freq * 997), index);
  const second = dual ? textureNoise(seed + 7919, index * 3 + 1) : base;
  const mixed = dual ? (base + second) / 2 : base;

  switch (resolveBrushTextureId(textureId)) {
    case 'fine-grain':
      // High-frequency, uniform grain.
      return clamp(mixed, 0, 1);
    case 'chalk': {
      // Harsh, high-contrast grain: push values toward the extremes.
      const sharpened = mixed * mixed * (3 - 2 * mixed); // smoothstep
      return clamp(sharpened < 0.5 ? sharpened * 0.4 : 0.6 + (sharpened - 0.5) * 0.8, 0, 1);
    }
    case 'spatter':
      // Mostly opaque with sparse, strong drop-outs (ink spatter).
      return clamp(mixed > 0.78 ? mixed * 0.2 : 0.85 + mixed * 0.15, 0, 1);
    case 'hatch': {
      // Directional banding: periodic light/dark stripes along the stroke.
      const band = (Math.sin(phase * Math.PI) + 1) / 2;
      return clamp(band * 0.8 + mixed * 0.2, 0, 1);
    }
    case 'dots': {
      // Periodic on/off halftone.
      const on = phase % 2 < 1;
      return clamp(on ? 0.9 + mixed * 0.1 : 0.12 + mixed * 0.12, 0, 1);
    }
    case 'canvas-grain':
    default: {
      // Woven canvas: a low-frequency weave crossed with grain.
      const weave = (Math.sin(phase * Math.PI * 0.5) + 1) / 2;
      return clamp(weave * 0.5 + mixed * 0.5, 0, 1);
    }
  }
}
