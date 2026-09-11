import type { BrushSettings } from '../../types/imageEditor';
import type { ImageBrushPreset, ImageBrushPresetGroup } from './ImageBrushPresets';

interface BrushFamilyVariant {
  id: string;
  label: string;
  settings: Partial<BrushSettings>;
}

interface BrushFamily {
  group: ImageBrushPresetGroup;
  base: Partial<BrushSettings>;
  variants: BrushFamilyVariant[];
}

function buildFamily(family: BrushFamily): ImageBrushPreset[] {
  return family.variants.map((variant) => ({
    id: `media-${variant.id}`,
    label: variant.label,
    group: family.group,
    settings: { ...family.base, ...variant.settings },
  }));
}

/**
 * Curated media families built exclusively from the existing brush-engine parameter surface.
 * Every family has nine deliberately different tools rather than numeric size clones. Across the
 * library these exercise pressure curves, pressure/tilt colour transfer, tip twist, deterministic
 * shape/transfer jitter, velocity response, wet pigment, paint depletion, texture, dual tips, and
 * RGB/spectral canvas mixing.
 */
const EXPANDED_BRUSH_FAMILIES: BrushFamily[] = [
  {
    group: 'Graphite & Pencil',
    base: {
      // Graphite is a dense succession of incomplete, paper-broken deposits. Pressure primarily
      // builds value; it should not inflate into an ink line. These proportions follow the mark
      // behavior shared by Krita's Pencil family and MyPaint's 2B/B pencils: soft-edged grain,
      // tight spacing, small random offsets, and strong opacity response.
      opacity: 0.7, hardness: 0.24, flow: 0.5, spacing: 0.04, scatter: 0.09,
      pressureSize: 0.2, pressureOpacity: 0.88, pressureFlow: 0.64, pressureHardness: 0.3,
      pressureCurve: 'sshape', sizeJitter: 0.1, opacityJitter: 0.16, flowJitter: 0.08,
      texture: 'fine-grain', textureScale: 0.62, textureDepth: 0.68,
      tiltAngle: 1, tiltRoundness: 0.94, tiltSize: 1, tiltOpacity: 0.18,
      tiltFlow: 0.12, rotationFollowsTwist: true, smoothing: 0.16,
    },
    variants: [
      { id: 'graphite-4h-draft', label: '4H Drafting Pencil', settings: { size: 2, opacity: 0.46, hardness: 0.32, flow: 0.34, pressureSize: 0.08, pressureOpacity: 0.68, pressureFlow: 0.42, pressureCurve: 'hard', scatter: 0.045, sizeJitter: 0.04, opacityJitter: 0.08, smoothing: 0.26, textureScale: 0.48, textureDepth: 0.52, tiltSize: 0.28, tiltRoundness: 0.35 } },
      { id: 'graphite-2h-detail', label: '2H Detail Pencil', settings: { size: 3, opacity: 0.56, hardness: 0.28, flow: 0.4, pressureSize: 0.12, pressureOpacity: 0.76, pressureFlow: 0.5, pressureCurve: 'hard', scatter: 0.06, sizeJitter: 0.06, opacityJitter: 0.1, smoothing: 0.22, textureDepth: 0.58, tiltSize: 0.45 } },
      { id: 'graphite-hb-writing', label: 'HB / No. 2 Pencil', settings: { size: 4, opacity: 0.68, hardness: 0.24, flow: 0.5, pressureSize: 0.16, pressureOpacity: 0.86, pressureFlow: 0.6, scatter: 0.085, sizeJitter: 0.09, opacityJitter: 0.14, textureDepth: 0.66, tiltSize: 0.72, tiltRoundness: 0.82 } },
      { id: 'graphite-2b-sketch', label: '2B Sketch Pencil', settings: { size: 5, opacity: 0.76, hardness: 0.22, flow: 0.54, pressureSize: 0.2, pressureOpacity: 0.9, pressureFlow: 0.68, scatter: 0.11, sizeJitter: 0.11, opacityJitter: 0.18, textureDepth: 0.72, tiltSize: 0.86, tiltRoundness: 0.92 } },
      { id: 'graphite-6b-soft', label: '6B Soft Graphite', settings: { size: 8, opacity: 0.84, hardness: 0.18, flow: 0.6, pressureSize: 0.24, pressureOpacity: 0.94, pressureFlow: 0.74, scatter: 0.14, sizeJitter: 0.14, opacityJitter: 0.2, tiltSize: 1, tiltRoundness: 1, tiltOpacity: 0.24, textureScale: 0.78, textureDepth: 0.78 } },
      { id: 'graphite-side-shader', label: 'Graphite Side Shader', settings: { size: 34, opacity: 0.46, hardness: 0.1, flow: 0.32, roundness: 0.22, spacing: 0.065, scatter: 0.13, pressureSize: 0.12, pressureOpacity: 0.76, pressureFlow: 0.58, pressureCurve: 'hard', sizeJitter: 0.16, opacityJitter: 0.22, tiltSize: 1, tiltRoundness: 1, tiltOpacity: 0.08, textureScale: 1.25, textureDepth: 0.84 } },
      { id: 'graphite-mechanical-05', label: '0.5 Mechanical Pencil', settings: { size: 2, opacity: 0.68, hardness: 0.38, flow: 0.48, pressureSize: 0.04, pressureOpacity: 0.76, pressureFlow: 0.48, pressureCurve: 'hard', scatter: 0.035, sizeJitter: 0.03, opacityJitter: 0.07, tiltSize: 0.08, tiltRoundness: 0.08, smoothing: 0.34, textureScale: 0.42, textureDepth: 0.48 } },
      { id: 'graphite-carpenter', label: 'Carpenter Pencil', settings: { size: 13, opacity: 0.72, hardness: 0.3, flow: 0.52, roundness: 0.24, angleDeg: 18, tipShape: 'square', pressureSize: 0.12, pressureRoundness: 0.46, scatter: 0.08, sizeJitter: 0.06, rotationFollowsTwist: true, textureScale: 0.85, textureDepth: 0.7 } },
      { id: 'graphite-blue-layout', label: 'Blue Layout Pencil', settings: { size: 4, color: '#4f9cff', opacity: 0.62, hardness: 0.22, flow: 0.46, pressureSize: 0.15, pressureOpacity: 0.84, pressureFlow: 0.58, scatter: 0.08, sizeJitter: 0.08, opacityJitter: 0.13, textureDepth: 0.64, tiltSize: 0.7 } },
    ],
  },
  {
    group: 'Charcoal & Conté',
    base: {
      opacity: 0.62, hardness: 0.22, flow: 0.42, spacing: 0.09, scatter: 0.24,
      pressureSize: 0.28, pressureOpacity: 0.84, pressureFlow: 0.64, pressureHardness: 0.18,
      pressureCurve: 'hard', sizeJitter: 0.18, opacityJitter: 0.2, flowJitter: 0.12,
      roundnessJitter: 0.1, angleJitter: 0.05, texture: 'chalk', textureScale: 1,
      textureDepth: 0.72, tiltAngle: 1, tiltRoundness: 0.94, tiltSize: 1,
      tiltOpacity: 0.22, tiltFlow: 0.14, rotationFollowsTwist: true, smoothing: 0.1,
    },
    variants: [
      { id: 'charcoal-vine-light', label: 'Vine Charcoal Light', settings: { size: 13, opacity: 0.46, hardness: 0.15, flow: 0.34, pressureOpacity: 0.56, scatter: 0.22, textureDepth: 0.58 } },
      { id: 'charcoal-vine-dark', label: 'Vine Charcoal Dark', settings: { size: 18, opacity: 0.74, hardness: 0.2, flow: 0.46, pressureOpacity: 0.78, textureDepth: 0.72 } },
      { id: 'charcoal-compressed', label: 'Compressed Charcoal', settings: { size: 22, opacity: 0.9, hardness: 0.42, flow: 0.65, spacing: 0.08, pressureFlow: 0.72, textureDepth: 0.56 } },
      { id: 'charcoal-block-side', label: 'Charcoal Block Side', settings: { size: 54, opacity: 0.55, hardness: 0.12, flow: 0.38, spacing: 0.02, roundness: 0.2, tipShape: 'square', angleDeg: 24, tiltSize: 1, tiltRoundness: 1, textureScale: 1.4, textureDepth: 0.82 } },
      { id: 'charcoal-powder', label: 'Charcoal Powder', settings: { size: 78, opacity: 0.22, hardness: 0.04, flow: 0.16, spacing: 0.18, scatter: 0.8, sizeJitter: 0.62, opacityJitter: 0.48, textureDepth: 0.76 } },
      { id: 'conte-black', label: 'Black Conté Crayon', settings: { size: 12, opacity: 0.9, hardness: 0.62, flow: 0.72, roundness: 0.44, angleDeg: 12, pressureSize: 0.32, textureScale: 0.65, textureDepth: 0.52 } },
      { id: 'conte-sanguine', label: 'Sanguine Conté', settings: { size: 14, color: '#9f3b2f', opacity: 0.84, hardness: 0.56, flow: 0.66, pressureColor: 0, tiltColor: 0, textureDepth: 0.54 } },
      { id: 'conte-white', label: 'White Conté Highlight', settings: { size: 10, color: '#f4ead2', opacity: 0.76, hardness: 0.66, flow: 0.62, pressureOpacity: 0.84, textureDepth: 0.46 } },
      { id: 'charcoal-kneaded-blender', label: 'Kneaded Charcoal Blender', settings: { size: 36, opacity: 0.18, hardness: 0.04, flow: 0.18, spacing: 0.045, scatter: 0.04, pressureSize: 0.76, pressureOpacity: 0.3, textureDepth: 0.34, mixerEnabled: true, smudgeLength: 0.58, smudgeRadius: 24, colorRate: 0.01, smudgeMode: 'dulling' } },
    ],
  },
  {
    group: 'Pastel & Chalk',
    base: {
      opacity: 0.72, hardness: 0.42, flow: 0.48, spacing: 0.1, scatter: 0.18,
      pressureSize: 0.22, pressureOpacity: 0.82, pressureFlow: 0.58, pressureHardness: 0.2,
      pressureCurve: 'hard', sizeJitter: 0.2, opacityJitter: 0.18, flowJitter: 0.12,
      roundnessJitter: 0.12, texture: 'chalk', textureScale: 1.1, textureDepth: 0.72,
      tiltAngle: 1, tiltRoundness: 0.88, tiltSize: 0.78, tiltOpacity: 0.16,
      tiltFlow: 0.12, pressureColor: 0, tiltColor: 0, rotationFollowsTwist: true,
    },
    variants: [
      { id: 'pastel-hard-edge', label: 'Hard Pastel Edge', settings: { size: 9, hardness: 0.72, flow: 0.72, spacing: 0.09, roundness: 0.38, pressureSize: 0.28, textureDepth: 0.5 } },
      { id: 'pastel-soft-stick', label: 'Soft Pastel Stick', settings: { size: 28, hardness: 0.24, flow: 0.48, pressureOpacity: 0.82, textureDepth: 0.78 } },
      { id: 'pastel-side-mass', label: 'Pastel Side Mass', settings: { size: 62, opacity: 0.48, hardness: 0.1, flow: 0.3, spacing: 0.02, roundness: 0.2, tipShape: 'square', angleDeg: 28, tiltSize: 1, tiltRoundness: 1, textureScale: 1.5, textureDepth: 0.86 } },
      { id: 'pastel-pencil', label: 'Pastel Pencil', settings: { size: 5, hardness: 0.8, flow: 0.74, spacing: 0.06, pressureSize: 0.45, smoothing: 0.25, textureScale: 0.7, textureDepth: 0.42 } },
      { id: 'chalk-school', label: 'School Chalk', settings: { size: 18, opacity: 0.68, hardness: 0.42, flow: 0.5, scatter: 0.24, sizeJitter: 0.12, flowJitter: 0.18, textureDepth: 0.74 } },
      { id: 'chalk-tailor', label: 'Tailor Chalk Wedge', settings: { size: 16, hardness: 0.7, flow: 0.58, roundness: 0.18, tipShape: 'square', angleDeg: 42, pressureRoundness: 0.68, rotationFollowsTwist: true } },
      { id: 'pastel-dust', label: 'Pastel Dust', settings: { size: 52, opacity: 0.2, hardness: 0.04, flow: 0.18, spacing: 0.22, scatter: 1.1, sizeJitter: 0.72, opacityJitter: 0.64, textureDepth: 0.82 } },
      { id: 'pastel-blender', label: 'Pastel Blender', settings: { size: 44, opacity: 0.3, hardness: 0.05, flow: 0.24, mixerEnabled: true, smudgeLength: 0.46, smudgeRadius: 22, colorRate: 0.08, smudgeMode: 'dulling', textureDepth: 0.34 } },
      { id: 'pastel-speckle', label: 'Pastel Speckle', settings: { size: 20, opacity: 0.62, hardness: 0.5, flow: 0.44, spacing: 0.24, scatter: 0.9, sizeJitter: 0.46, roundnessJitter: 0.35, angleJitter: 0.3, textureDepth: 0.72 } },
    ],
  },
  {
    group: 'Ink & Calligraphy',
    base: {
      opacity: 1, hardness: 0.98, flow: 1, spacing: 0.035, pressureSize: 0.78,
      pressureOpacity: 0.02, pressureFlow: 0.04, pressureCurve: 'sshape', smoothing: 0.36,
      tiltAngle: 0.8, tiltRoundness: 0.42, tiltSize: 0.2, rotationFollowsTwist: true,
    },
    variants: [
      { id: 'ink-crow-quill', label: 'Crow Quill', settings: { size: 7, hardness: 1, pressureSize: 0.94, pressureCurve: 'hard', smoothing: 0.28 } },
      { id: 'ink-g-pen', label: 'G-Pen', settings: { size: 13, hardness: 1, pressureSize: 1, pressureFlow: 0.05, smoothing: 0.42 } },
      { id: 'ink-maru-pen', label: 'Maru Pen', settings: { size: 5, hardness: 1, pressureSize: 0.7, smoothing: 0.48 } },
      { id: 'ink-sable-round', label: 'Sable Ink Brush', settings: { size: 24, hardness: 0.78, flow: 0.86, roundness: 0.52, pressureSize: 0.96, pressureOpacity: 0.18, pressureRoundness: 0.32, smoothing: 0.5 } },
      { id: 'ink-flat-brush', label: 'Flat Ink Brush', settings: { size: 34, hardness: 0.9, flow: 0.82, tipShape: 'square', roundness: 0.26, angleDeg: 20, pressureSize: 0.52, pressureRoundness: 0.72, rotationFollowsTwist: true } },
      { id: 'ink-broad-nib', label: 'Broad-Edge Nib', settings: { size: 28, hardness: 1, tipShape: 'square', roundness: 0.2, angleDeg: 38, pressureSize: 0.12, tiltAngle: 0.3, rotationFollowsTwist: true } },
      { id: 'ink-ruling-pen', label: 'Ruling Pen', settings: { size: 4, hardness: 1, flow: 1, pressureSize: 0, pressureOpacity: 0, pressureFlow: 0, smoothing: 0.56, rotationFollowsTwist: false } },
      { id: 'ink-dry-sumi', label: 'Dry Sumi Brush', settings: { size: 42, opacity: 0.86, hardness: 0.5, flow: 0.52, spacing: 0.11, scatter: 0.12, roundness: 0.4, pressureFlow: 0.62, texture: 'hatch', textureScale: 0.8, textureDepth: 0.68, paintLoad: 0.9, loadFalloff: 0.0012 } },
      { id: 'ink-splatter-loaded', label: 'Loaded Ink Splatter', settings: { size: 18, opacity: 0.9, hardness: 0.84, flow: 0.72, spacing: 0.2, scatter: 1.3, sizeJitter: 0.72, opacityJitter: 0.32, angleJitter: 1, texture: 'spatter', textureDepth: 0.66 } },
    ],
  },
  {
    group: 'Markers',
    base: {
      opacity: 0.76, hardness: 0.74, flow: 0.62, spacing: 0.055, pressureSize: 0.06,
      pressureOpacity: 0.08, pressureFlow: 0.1, pressureColor: 0, tiltColor: 0,
      wetEdges: true, smoothing: 0.2, rotationFollowsTwist: true,
    },
    variants: [
      { id: 'marker-felt-fine', label: 'Fine Felt Marker', settings: { size: 6, hardness: 0.86, opacity: 0.82, flow: 0.88, pressureSize: 0.08 } },
      { id: 'marker-felt-broad', label: 'Broad Felt Marker', settings: { size: 26, hardness: 0.68, roundness: 0.72, pressureSize: 0.1 } },
      { id: 'marker-chisel', label: 'Chisel Marker', settings: { size: 32, hardness: 0.8, tipShape: 'square', roundness: 0.22, angleDeg: 35, pressureRoundness: 0.32, rotationFollowsTwist: true } },
      { id: 'marker-alcohol-layer', label: 'Alcohol Marker Layer', settings: { size: 38, opacity: 0.28, hardness: 0.45, flow: 0.38, pressureOpacity: 0.22, pressureColor: 0, wetEdges: true } },
      { id: 'marker-alcohol-blender', label: 'Colorless Blender', settings: { size: 46, opacity: 0.16, hardness: 0.25, flow: 0.22, mixerEnabled: true, smudgeLength: 0.42, smudgeRadius: 22, colorRate: 0, wetEdges: true } },
      { id: 'marker-paint-opaque', label: 'Opaque Paint Marker', settings: { size: 16, opacity: 1, hardness: 0.9, flow: 0.9, pressureOpacity: 0.02, pressureColor: 0, wetEdges: false } },
      { id: 'marker-brush-tip', label: 'Brush-Tip Marker', settings: { size: 22, hardness: 0.7, roundness: 0.45, pressureSize: 0.78, pressureFlow: 0.32, smoothing: 0.44 } },
      { id: 'marker-dry-felt', label: 'Dry Felt Marker', settings: { size: 20, opacity: 0.58, hardness: 0.6, flow: 0.42, spacing: 0.12, scatter: 0.12, texture: 'fine-grain', textureScale: 0.7, textureDepth: 0.56, paintLoad: 0.72, loadFalloff: 0.0012 } },
      { id: 'marker-highlighter', label: 'Translucent Highlighter', settings: { size: 34, color: '#fff36b', opacity: 0.22, hardness: 0.58, flow: 0.42, tipShape: 'square', roundness: 0.28, angleDeg: 0, pressureSize: 0.04, pressureOpacity: 0.08 } },
    ],
  },
  {
    group: 'Watercolor',
    base: {
      opacity: 0.28, hardness: 0.08, flow: 0.2, spacing: 0.05, pressureSize: 0.46,
      pressureOpacity: 0.34, pressureFlow: 0.9, pressureColor: 0, tiltColor: 0,
      wetEdges: true, wetMedia: true, wetMix: 0.62, wetLoad: 0.72, wetPull: 0.48,
      texture: 'fine-grain', textureScale: 1.2, textureDepth: 0.28, smoothing: 0.34,
      mixerEnabled: true, smudgeLength: 0.7, smudgeRadius: 18, colorRate: 0.22,
      mixMode: 'spectral', smudgeMode: 'dulling',
    },
    variants: [
      { id: 'watercolor-round-6', label: 'Watercolor Round #6', settings: { size: 26, hardness: 0.16, flow: 0.3, pressureSize: 0.72, pressureFlow: 0.92, wetMix: 0.48, wetLoad: 0.8 } },
      { id: 'watercolor-mop-wash', label: 'Mop Wash', settings: { size: 120, opacity: 0.18, hardness: 0.01, flow: 0.12, spacing: 0.05, pressureFlow: 0.94, wetMix: 0.82, wetPull: 0.62, textureScale: 1.6 } },
      { id: 'watercolor-flat-wash', label: 'Flat Wash', settings: { size: 72, opacity: 0.24, hardness: 0.04, flow: 0.18, tipShape: 'square', roundness: 0.48, angleDeg: 8, pressureFlow: 0.8, wetMix: 0.74 } },
      { id: 'watercolor-drybrush', label: 'Watercolor Drybrush', settings: { size: 42, opacity: 0.42, hardness: 0.38, flow: 0.22, spacing: 0.14, scatter: 0.18, wetMix: 0.2, wetLoad: 0.44, wetPull: 0.12, texture: 'canvas-grain', textureDepth: 0.62, paintLoad: 0.64, loadFalloff: 0.0012, mixerEnabled: false } },
      { id: 'watercolor-bloom', label: 'Watercolor Bloom', settings: { size: 96, opacity: 0.14, hardness: 0, flow: 0.1, spacing: 0.1, scatter: 0.16, sizeJitter: 0.26, opacityJitter: 0.22, wetMix: 0.94, wetPull: 0.82, wetLoad: 0.5 } },
      { id: 'watercolor-granulating', label: 'Granulating Wash', settings: { size: 84, opacity: 0.24, hardness: 0.03, flow: 0.16, texture: 'canvas-grain', textureScale: 1.8, textureDepth: 0.58, dualBrush: true, wetMix: 0.8, wetPull: 0.58 } },
      { id: 'watercolor-liner', label: 'Watercolor Rigger', settings: { size: 9, opacity: 0.42, hardness: 0.24, flow: 0.34, spacing: 0.045, pressureSize: 0.86, smoothing: 0.56, wetMix: 0.34, wetPull: 0.28 } },
      { id: 'watercolor-lifting', label: 'Watercolor Lifting Brush', settings: { size: 52, opacity: 0.12, hardness: 0.08, flow: 0.12, mixerEnabled: true, smudgeLength: 0.9, smudgeRadius: 28, colorRate: 0.01, smudgeMode: 'dulling', wetMix: 0.7, wetPull: 0.9 } },
      { id: 'watercolor-salt', label: 'Salt Texture Wash', settings: { size: 70, opacity: 0.2, hardness: 0.04, flow: 0.14, spacing: 0.12, scatter: 0.4, sizeJitter: 0.48, opacityJitter: 0.34, texture: 'spatter', textureScale: 1.4, textureDepth: 0.54, wetMix: 0.82 } },
    ],
  },
  {
    group: 'Gouache & Tempera',
    base: {
      opacity: 0.92, hardness: 0.64, flow: 0.64, spacing: 0.085, pressureSize: 0.38,
      pressureOpacity: 0.12, pressureFlow: 0.52, pressureColor: 0, tiltColor: 0,
      texture: 'canvas-grain', textureScale: 1, textureDepth: 0.18, smoothing: 0.28,
    },
    variants: [
      { id: 'gouache-round', label: 'Gouache Round', settings: { size: 34, hardness: 0.68, flow: 0.72, pressureSize: 0.66, pressureFlow: 0.55 } },
      { id: 'gouache-flat', label: 'Gouache Flat', settings: { size: 48, hardness: 0.76, tipShape: 'square', roundness: 0.42, angleDeg: 5, pressureRoundness: 0.42, rotationFollowsTwist: true } },
      { id: 'gouache-dry', label: 'Dry Gouache', settings: { size: 44, opacity: 0.78, hardness: 0.5, flow: 0.4, spacing: 0.14, scatter: 0.16, textureDepth: 0.56, paintLoad: 0.72, loadFalloff: 0.0012 } },
      { id: 'gouache-block-in', label: 'Gouache Block-In', settings: { size: 82, opacity: 1, hardness: 0.72, flow: 0.78, spacing: 0.1, tipShape: 'square', roundness: 0.72, pressureFlow: 0.32 } },
      { id: 'gouache-detail', label: 'Gouache Detail', settings: { size: 9, hardness: 0.86, flow: 0.82, spacing: 0.045, pressureSize: 0.74, smoothing: 0.42 } },
      { id: 'tempera-round', label: 'Egg Tempera Round', settings: { size: 22, opacity: 0.72, hardness: 0.58, flow: 0.46, pressureOpacity: 0.38, pressureFlow: 0.62, textureDepth: 0.12 } },
      { id: 'tempera-hatch', label: 'Tempera Hatch', settings: { size: 7, opacity: 0.78, hardness: 0.78, flow: 0.64, spacing: 0.08, roundness: 0.36, texture: 'hatch', textureScale: 0.75, textureDepth: 0.3, angleJitter: 0.08 } },
      { id: 'casein-matte', label: 'Casein Matte', settings: { size: 54, opacity: 1, hardness: 0.62, flow: 0.68, pressureColor: 0, tiltColor: 0, textureDepth: 0.22 } },
      { id: 'gouache-blender', label: 'Gouache Blender', settings: { size: 46, opacity: 0.54, hardness: 0.22, flow: 0.36, mixerEnabled: true, smudgeLength: 0.44, smudgeRadius: 24, colorRate: 0.34, mixMode: 'spectral', smudgeMode: 'dulling' } },
    ],
  },
  {
    group: 'Oils & Acrylics',
    base: {
      opacity: 0.96, hardness: 0.62, flow: 0.68, spacing: 0.065, pressureSize: 0.32,
      pressureOpacity: 0.08, pressureFlow: 0.6, pressureColor: 0, tiltColor: 0,
      pressureCurve: 'hard', texture: 'canvas-grain', textureScale: 0.9, textureDepth: 0.3,
      mixerEnabled: true, smudgeLength: 0.72, smudgeRadius: 18, colorRate: 0.56,
      mixMode: 'spectral', smudgeMode: 'smearing', tiltAngle: 0.7, tiltRoundness: 0.55,
      tiltSize: 0.22, rotationFollowsTwist: true,
    },
    variants: [
      { id: 'oil-filbert', label: 'Oil Filbert', settings: { size: 52, hardness: 0.62, roundness: 0.56, angleDeg: 12, pressureSize: 0.58, pressureRoundness: 0.34, colorRate: 0.46 } },
      { id: 'oil-flat', label: 'Oil Flat', settings: { size: 64, hardness: 0.7, tipShape: 'square', roundness: 0.32, angleDeg: 16, pressureRoundness: 0.5, rotationFollowsTwist: true, colorRate: 0.56 } },
      { id: 'oil-hog-bristle', label: 'Hog Bristle Oil', settings: { size: 48, hardness: 0.48, flow: 0.58, spacing: 0.12, scatter: 0.12, textureDepth: 0.5, dualBrush: true, paintLoad: 0.9, loadFalloff: 0.0008 } },
      { id: 'oil-palette-knife', label: 'Palette Knife', settings: { size: 76, hardness: 0.9, flow: 0.82, tipShape: 'square', roundness: 0.14, angleDeg: 6, pressureSize: 0.18, pressureRoundness: 0.76, tiltAngle: 1, rotationFollowsTwist: true, textureDepth: 0.18, colorRate: 0.66 } },
      { id: 'oil-glaze', label: 'Oil Glaze', settings: { size: 92, opacity: 0.2, hardness: 0.08, flow: 0.2, spacing: 0.045, pressureSize: 0.12, pressureFlow: 0.82, mixerEnabled: false, textureDepth: 0.08 } },
      { id: 'oil-impasto', label: 'Impasto Rake', settings: { size: 58, hardness: 0.8, flow: 0.86, spacing: 0.13, roundness: 0.42, texture: 'hatch', textureScale: 0.55, textureDepth: 0.72, dualBrush: true, pressureFlow: 0.72, paintLoad: 1, loadFalloff: 0.0005 } },
      { id: 'acrylic-flat', label: 'Acrylic Flat', settings: { size: 56, opacity: 1, hardness: 0.78, flow: 0.76, tipShape: 'square', roundness: 0.4, mixerEnabled: false, smudgeLength: 0.5, colorRate: 0.5, textureDepth: 0.2 } },
      { id: 'acrylic-dry', label: 'Acrylic Drybrush', settings: { size: 42, opacity: 0.84, hardness: 0.54, flow: 0.42, spacing: 0.15, scatter: 0.18, mixerEnabled: false, textureDepth: 0.62, paintLoad: 0.68, loadFalloff: 0.0013 } },
      { id: 'acrylic-scumble', label: 'Acrylic Scumble', settings: { size: 74, opacity: 0.34, hardness: 0.2, flow: 0.24, spacing: 0.12, scatter: 0.16, mixerEnabled: false, textureDepth: 0.48, opacityJitter: 0.2, flowJitter: 0.18 } },
    ],
  },
  {
    group: 'Bristle & Dry Media',
    base: {
      opacity: 0.84, hardness: 0.58, flow: 0.44, spacing: 0.11, scatter: 0.14,
      pressureSize: 0.24, pressureOpacity: 0.18, pressureFlow: 0.76, texture: 'hatch',
      textureScale: 0.8, textureDepth: 0.54, dualBrush: true, paintLoad: 0.82,
      loadFalloff: 0.0009, tiltAngle: 0.8, tiltRoundness: 0.58, tiltSize: 0.18,
      rotationFollowsTwist: true, sizeJitter: 0.08, flowJitter: 0.12,
    },
    variants: [
      { id: 'dry-fan-brush', label: 'Dry Fan Brush', settings: { size: 72, hardness: 0.38, flow: 0.32, roundness: 0.18, angleDeg: 8, scatter: 0.28, textureDepth: 0.7, angleJitter: 0.08 } },
      { id: 'dry-rake', label: 'Bristle Rake', settings: { size: 46, hardness: 0.72, flow: 0.54, roundness: 0.26, textureScale: 0.45, textureDepth: 0.82, pressureFlow: 0.75 } },
      { id: 'dry-streak', label: 'Long Dry Streak', settings: { size: 24, hardness: 0.64, flow: 0.56, spacing: 0.07, fadeLength: 10, paintLoad: 0.9, loadFalloff: 0.0018, smoothing: 0.34 } },
      { id: 'dry-scrub', label: 'Dry Scrub', settings: { size: 38, hardness: 0.46, flow: 0.4, spacing: 0.17, scatter: 0.34, sizeJitter: 0.26, roundnessJitter: 0.32, angleJitter: 0.54, textureDepth: 0.68 } },
      { id: 'dry-sponge', label: 'Natural Sponge Dry', settings: { size: 68, hardness: 0.28, flow: 0.3, spacing: 0.22, scatter: 0.75, sizeJitter: 0.55, opacityJitter: 0.4, roundnessJitter: 0.5, texture: 'spatter', textureDepth: 0.72 } },
      { id: 'dry-stencil', label: 'Stencil Scrub', settings: { size: 30, hardness: 0.76, flow: 0.58, spacing: 0.12, tipShape: 'square', roundness: 0.68, angleJitter: 0.2, textureDepth: 0.46 } },
      { id: 'dry-house-brush', label: 'Weathered House Brush', settings: { size: 96, hardness: 0.5, flow: 0.44, tipShape: 'square', roundness: 0.34, angleDeg: 4, scatter: 0.2, textureDepth: 0.76, paintLoad: 0.7, loadFalloff: 0.0012 } },
      { id: 'dry-crosshatch', label: 'Crosshatch Bristle', settings: { size: 18, hardness: 0.8, flow: 0.64, spacing: 0.1, texture: 'hatch', textureScale: 0.5, textureDepth: 0.74, angleJitter: 0.16, velocitySpacing: 0.3 } },
      { id: 'dry-edge-breaker', label: 'Broken Edge Bristle', settings: { size: 34, hardness: 0.62, flow: 0.5, spacing: 0.11, roundness: 0.45, scatter: 0.12, sizeJitter: 0.18, opacityJitter: 0.25, flowJitter: 0.3, textureDepth: 0.66 } },
    ],
  },
  {
    group: 'Airbrush & Glaze',
    base: {
      opacity: 0.24, hardness: 0.04, flow: 0.18, spacing: 0.035, pressureSize: 0.22,
      pressureOpacity: 0.42, pressureFlow: 0.9, pressureColor: 0, tiltColor: 0,
      smoothing: 0.44, velocityOpacity: 0.28, velocityFlow: 0,
    },
    variants: [
      { id: 'airbrush-detail', label: 'Detail Airbrush', settings: { size: 24, opacity: 0.32, hardness: 0.16, flow: 0.26, pressureSize: 0.5, smoothing: 0.52 } },
      { id: 'airbrush-soft', label: 'Soft Airbrush', settings: { size: 86, opacity: 0.2, hardness: 0.01, flow: 0.18, pressureFlow: 0.92 } },
      { id: 'airbrush-wide', label: 'Wide Airbrush', settings: { size: 170, opacity: 0.12, hardness: 0, flow: 0.1, spacing: 0.035, pressureFlow: 0.96 } },
      { id: 'airbrush-grain', label: 'Grain Airbrush', settings: { size: 92, opacity: 0.22, hardness: 0.03, flow: 0.16, scatter: 0.18, texture: 'fine-grain', textureScale: 1.4, textureDepth: 0.34, opacityJitter: 0.16 } },
      { id: 'airbrush-spray', label: 'Coarse Spray', settings: { size: 76, opacity: 0.24, hardness: 0.28, flow: 0.2, spacing: 0.12, scatter: 1.1, sizeJitter: 0.64, opacityJitter: 0.46, texture: 'spatter', textureDepth: 0.52 } },
      { id: 'airbrush-blush', label: 'Blush Glaze', settings: { size: 120, color: '#ff8fab', opacity: 0.1, hardness: 0, flow: 0.08, pressureColor: 0, tiltColor: 0 } },
      { id: 'airbrush-shadow', label: 'Ambient Shadow Glaze', settings: { size: 150, color: '#53607a', opacity: 0.09, hardness: 0, flow: 0.08, pressureFlow: 0.9, pressureColor: 0 } },
      { id: 'airbrush-edge', label: 'Controlled Soft Edge', settings: { size: 58, opacity: 0.3, hardness: 0.18, flow: 0.25, roundness: 0.56, angleDeg: 20, tiltAngle: 0.8, tiltRoundness: 0.72, tiltSize: 0.42, rotationFollowsTwist: true } },
      { id: 'airbrush-mist', label: 'Atmosphere Mist', settings: { size: 210, color: '#cfe9ff', opacity: 0.06, hardness: 0, flow: 0.05, spacing: 0.08, scatter: 0.38, sizeJitter: 0.42, opacityJitter: 0.5 } },
    ],
  },
  {
    group: 'Digital Paint',
    base: {
      opacity: 1, hardness: 0.78, flow: 0.82, spacing: 0.05, pressureSize: 0.58,
      pressureOpacity: 0.12, pressureFlow: 0.5, pressureCurve: 'sshape', smoothing: 0.34,
      pressureColor: 0, tiltColor: 0, rotationFollowsTwist: false,
    },
    variants: [
      { id: 'digital-clean-round', label: 'Clean Paint Round', settings: { size: 34, hardness: 0.84, flow: 0.88, pressureSize: 0.7, smoothing: 0.42 } },
      { id: 'digital-soft-render', label: 'Soft Rendering Brush', settings: { size: 72, opacity: 0.42, hardness: 0.12, flow: 0.38, pressureOpacity: 0.48, pressureFlow: 0.72 } },
      { id: 'digital-flat-concept', label: 'Concept Flat', settings: { size: 54, hardness: 0.92, flow: 0.92, tipShape: 'square', roundness: 0.48, angleDeg: 10, pressureSize: 0.5, pressureRoundness: 0.44, tiltAngle: 0.65, tiltRoundness: 0.5, rotationFollowsTwist: true } },
      { id: 'digital-sculpt', label: 'Sculpting Brush', settings: { size: 46, hardness: 0.66, flow: 0.56, pressureSize: 0.66, pressureOpacity: 0.4, pressureFlow: 0.78, pressureHardness: 0.58, pressureColor: 0.52 } },
      { id: 'digital-cell-shade', label: 'Cel Shade Blocker', settings: { size: 64, hardness: 1, flow: 1, spacing: 0.08, pressureSize: 0.18, pressureOpacity: 0, pressureFlow: 0.08, smoothing: 0.18 } },
      { id: 'digital-pixel-crisp', label: 'Pixel-Crisp Round', settings: { size: 6, hardness: 1, flow: 1, spacing: 0.04, pressureSize: 0, pressureOpacity: 0, pressureFlow: 0, smoothing: 0, rotationFollowsTwist: false } },
      { id: 'digital-speed-paint', label: 'Speed Paint Wedge', settings: { size: 78, hardness: 0.72, flow: 0.76, tipShape: 'square', roundness: 0.26, angleDeg: 25, pressureSize: 0.48, velocitySize: 0.34, velocityOpacity: 0.22, velocitySpacing: 0.3, tiltAngle: 0.7, tiltRoundness: 0.62, rotationFollowsTwist: true } },
      { id: 'digital-color-shift', label: 'Pressure Color Shift', settings: { size: 48, hardness: 0.58, flow: 0.6, pressureColor: 0.9, tiltColor: 0.72, pressureOpacity: 0.36, pressureFlow: 0.62 } },
      { id: 'digital-noise-painter', label: 'Noise Painter', settings: { size: 42, hardness: 0.48, flow: 0.52, spacing: 0.09, sizeJitter: 0.28, opacityJitter: 0.22, flowJitter: 0.2, roundnessJitter: 0.26, angleJitter: 0.34, texture: 'fine-grain', textureDepth: 0.38, dualBrush: true } },
    ],
  },
  {
    group: 'Texture & Stamps',
    base: {
      opacity: 0.72, hardness: 0.62, flow: 0.62, spacing: 0.2, scatter: 0.56,
      pressureSize: 0.16, pressureOpacity: 0.28, pressureFlow: 0.34, sizeJitter: 0.38,
      opacityJitter: 0.28, roundnessJitter: 0.24, angleJitter: 0.66,
    },
    variants: [
      { id: 'texture-paper-tooth', label: 'Paper Tooth', settings: { size: 36, texture: 'fine-grain', textureScale: 0.55, textureDepth: 0.72, dualBrush: true, scatter: 0.18, spacing: 0.12 } },
      { id: 'texture-canvas-weave', label: 'Canvas Weave', settings: { size: 48, texture: 'canvas-grain', textureScale: 0.8, textureDepth: 0.78, dualBrush: true, scatter: 0.12, spacing: 0.1 } },
      { id: 'texture-chalk-noise', label: 'Chalk Noise', settings: { size: 34, hardness: 0.42, texture: 'chalk', textureScale: 1.2, textureDepth: 0.82, scatter: 0.3 } },
      { id: 'texture-ink-spatter', label: 'Ink Spatter', settings: { size: 26, hardness: 0.84, texture: 'spatter', textureScale: 1, textureDepth: 0.74, scatter: 1.45, sizeJitter: 0.76, spacing: 0.25 } },
      { id: 'texture-hatch', label: 'Directional Hatch', settings: { size: 18, hardness: 0.82, texture: 'hatch', textureScale: 0.5, textureDepth: 0.82, scatter: 0.1, angleJitter: 0.12, spacing: 0.1 } },
      { id: 'texture-halftone', label: 'Halftone Dot Trail', settings: { size: 7, hardness: 1, flow: 0.9, texture: 'dots', textureScale: 0.9, textureDepth: 0.92, scatter: 0, sizeJitter: 0, opacityJitter: 0, angleJitter: 0, spacing: 1.35, pressureSize: 0, pressureOpacity: 0 } },
      { id: 'texture-rubble', label: 'Rubble Scatter', settings: { size: 34, hardness: 0.72, texture: 'spatter', textureScale: 1.6, textureDepth: 0.64, scatter: 1.6, sizeJitter: 0.84, roundnessJitter: 0.68, angleJitter: 1, spacing: 0.32 } },
      { id: 'texture-grunge-edge', label: 'Grunge Edge', settings: { size: 62, hardness: 0.48, texture: 'canvas-grain', textureScale: 1.3, textureDepth: 0.8, dualBrush: true, scatter: 0.26, sizeJitter: 0.28, opacityJitter: 0.42 } },
      { id: 'texture-dust-cloud', label: 'Dust Cloud', settings: { size: 90, opacity: 0.18, hardness: 0.04, flow: 0.16, texture: 'fine-grain', textureScale: 1.8, textureDepth: 0.6, scatter: 1.2, sizeJitter: 0.72, opacityJitter: 0.7, spacing: 0.3 } },
    ],
  },
  {
    group: 'Nature & Organic',
    base: {
      opacity: 0.78, hardness: 0.56, flow: 0.64, spacing: 0.18, scatter: 0.7,
      pressureSize: 0.2, pressureOpacity: 0.28, pressureFlow: 0.38, sizeJitter: 0.52,
      opacityJitter: 0.24, roundnessJitter: 0.46, angleJitter: 0.8, texture: 'spatter',
      textureScale: 1.1, textureDepth: 0.44,
    },
    variants: [
      { id: 'organic-foliage', label: 'Foliage Scatter', settings: { size: 28, color: '#5aa469', scatter: 1.1, sizeJitter: 0.7, angleJitter: 1, pressureColor: 0.55, tiltColor: 0.35 } },
      { id: 'organic-grass', label: 'Grass Blades', settings: { size: 20, color: '#6e9f58', hardness: 0.78, roundness: 0.14, angleDeg: 5, scatter: 0.5, sizeJitter: 0.5, angleJitter: 0.18, spacing: 0.12, pressureSize: 0.72, tiltAngle: 0.7 } },
      { id: 'organic-bark', label: 'Bark Grain', settings: { size: 36, color: '#7b5b42', texture: 'hatch', textureScale: 0.55, textureDepth: 0.72, scatter: 0.28, roundness: 0.34, angleJitter: 0.2 } },
      { id: 'organic-rock', label: 'Rock Texture', settings: { size: 44, color: '#7d838b', hardness: 0.74, scatter: 1.15, sizeJitter: 0.72, roundnessJitter: 0.6, textureDepth: 0.62, spacing: 0.26 } },
      { id: 'organic-cloud', label: 'Cloud Cluster', settings: { size: 96, color: '#e8f1ff', opacity: 0.18, hardness: 0.03, flow: 0.14, scatter: 0.46, sizeJitter: 0.42, opacityJitter: 0.34, texture: 'fine-grain', textureDepth: 0.2 } },
      { id: 'organic-foam', label: 'Sea Foam', settings: { size: 32, color: '#d9fbff', opacity: 0.56, hardness: 0.42, flow: 0.5, scatter: 1.25, sizeJitter: 0.74, opacityJitter: 0.38, texture: 'spatter', textureDepth: 0.58 } },
      { id: 'organic-rain', label: 'Rain Streaks', settings: { size: 10, color: '#8fd5ff', opacity: 0.4, hardness: 0.7, roundness: 0.12, angleDeg: 65, scatter: 0.8, sizeJitter: 0.58, angleJitter: 0.04, spacing: 0.2, velocitySize: 0.5, velocityOpacity: 0.42 } },
      { id: 'organic-snow', label: 'Snow Flurry', settings: { size: 18, color: '#ffffff', opacity: 0.74, hardness: 0.82, scatter: 1.7, sizeJitter: 0.86, opacityJitter: 0.34, spacing: 0.34, roundnessJitter: 0.18 } },
      { id: 'organic-fur', label: 'Fur Strands', settings: { size: 12, hardness: 0.82, roundness: 0.16, angleDeg: 0, scatter: 0.32, sizeJitter: 0.6, angleJitter: 0.16, spacing: 0.09, pressureSize: 0.76, tiltAngle: 0.8, rotationFollowsTwist: true } },
    ],
  },
  {
    group: 'Comic & Manga Pro',
    base: {
      opacity: 1, hardness: 1, flow: 1, spacing: 0.03, pressureSize: 0.78,
      pressureOpacity: 0, pressureFlow: 0.03, pressureCurve: 'sshape', smoothing: 0.42,
    },
    variants: [
      { id: 'comic-gpen-bold', label: 'G-Pen Bold', settings: { size: 17, pressureSize: 1, smoothing: 0.48 } },
      { id: 'comic-maru-fine', label: 'Maru Pen Fine', settings: { size: 4, pressureSize: 0.66, smoothing: 0.52 } },
      { id: 'comic-school-pen', label: 'School Pen', settings: { size: 8, pressureSize: 0.38, smoothing: 0.36 } },
      { id: 'comic-brush-black', label: 'Manga Black Brush', settings: { size: 32, hardness: 0.86, flow: 0.92, roundness: 0.48, pressureSize: 0.94, pressureRoundness: 0.3, smoothing: 0.5 } },
      { id: 'comic-border', label: 'Panel Border Liner', settings: { size: 7, pressureSize: 0, pressureOpacity: 0, pressureFlow: 0, smoothing: 0.68 } },
      { id: 'comic-tone-fine', label: 'Fine Screentone Stipple', settings: { size: 4, opacity: 0.82, texture: 'dots', textureScale: 0.55, textureDepth: 0.94, spacing: 1.25, scatter: 0.12, sizeJitter: 0, opacityJitter: 0, pressureSize: 0, pressureOpacity: 0, smoothing: 0 } },
      { id: 'comic-tone-coarse', label: 'Coarse Screentone Stipple', settings: { size: 8, opacity: 0.84, texture: 'dots', textureScale: 1.55, textureDepth: 0.92, spacing: 1.35, scatter: 0.16, sizeJitter: 0, opacityJitter: 0, pressureSize: 0, pressureOpacity: 0, smoothing: 0 } },
      { id: 'comic-speed-taper', label: 'Speed Line Taper', settings: { size: 6, roundness: 0.2, pressureSize: 0.72, velocitySize: 0.62, velocityOpacity: 0.48, velocitySpacing: 0.36, smoothing: 0.24, fadeLength: 6 } },
      { id: 'comic-whiteout', label: 'Whiteout Brush', settings: { size: 24, color: '#ffffff', hardness: 0.94, flow: 0.96, pressureSize: 0.48, smoothing: 0.3 } },
    ],
  },
  {
    group: 'FX & Light',
    base: {
      opacity: 0.62, hardness: 0.32, flow: 0.54, spacing: 0.1, pressureSize: 0.42,
      pressureOpacity: 0.36, pressureFlow: 0.58, pressureColor: 0, tiltColor: 0,
      smoothing: 0.32,
    },
    variants: [
      { id: 'fx-neon-core', label: 'Neon Core', settings: { size: 22, color: '#72f7ff', opacity: 0.74, hardness: 0.54, flow: 0.72, spacing: 0.055, smoothing: 0.52 } },
      { id: 'fx-neon-glow', label: 'Neon Glow', settings: { size: 74, color: '#72f7ff', opacity: 0.18, hardness: 0.01, flow: 0.14, spacing: 0.045, pressureFlow: 0.86 } },
      { id: 'fx-spark-trail', label: 'Spark Trail', settings: { size: 16, color: '#fff4a8', opacity: 0.9, hardness: 0.9, flow: 0.76, spacing: 0.18, scatter: 1.35, sizeJitter: 0.76, opacityJitter: 0.42, angleJitter: 1, texture: 'spatter', textureDepth: 0.52 } },
      { id: 'fx-magic-particles', label: 'Magic Particles', settings: { size: 22, color: '#c59cff', opacity: 0.72, hardness: 0.72, flow: 0.62, spacing: 0.24, scatter: 1.6, sizeJitter: 0.84, opacityJitter: 0.5, roundnessJitter: 0.38, pressureColor: 0.8 } },
      { id: 'fx-fire-ember', label: 'Fire Embers', settings: { size: 14, color: '#ff7a35', opacity: 0.88, hardness: 0.82, flow: 0.72, spacing: 0.2, scatter: 1.25, sizeJitter: 0.7, opacityJitter: 0.4, velocitySize: 0.5, velocityOpacity: 0.5, pressureColor: 0.72 } },
      { id: 'fx-smoke', label: 'Smoke Ribbon', settings: { size: 96, color: '#94a0b8', opacity: 0.12, hardness: 0, flow: 0.1, spacing: 0.06, scatter: 0.18, sizeJitter: 0.3, opacityJitter: 0.36, smoothing: 0.58, tiltColor: 0.46 } },
      { id: 'fx-speed-glow', label: 'Speed Glow', settings: { size: 38, color: '#a7d8ff', opacity: 0.34, hardness: 0.14, flow: 0.28, roundness: 0.22, velocitySize: 0.72, velocityOpacity: 0.44, velocityFlow: 0.36, velocitySpacing: 0.5, smoothing: 0.3 } },
      { id: 'fx-prism-shift', label: 'Prism Shift', settings: { size: 46, color: '#ff74d4', opacity: 0.38, hardness: 0.18, flow: 0.32, pressureColor: 1, tiltColor: 1, pressureOpacity: 0.54, pressureFlow: 0.64 } },
      { id: 'fx-star-stamp', label: 'Starfield Stamp', settings: { size: 20, color: '#ffffff', opacity: 0.86, hardness: 1, flow: 0.9, spacing: 0.3, scatter: 1.8, sizeJitter: 0.92, opacityJitter: 0.52, texture: 'spatter', textureScale: 0.8, textureDepth: 0.66 } },
    ],
  },
  {
    group: 'Blend & Smudge',
    base: {
      opacity: 0.72, hardness: 0.28, flow: 0.48, spacing: 0.045, pressureSize: 0.18,
      pressureOpacity: 0.08, pressureFlow: 0.5, mixerEnabled: true, smudgeLength: 0.62,
      smudgeRadius: 18, colorRate: 0.3, mixMode: 'rgb', smudgeMode: 'smearing', smoothing: 0.42,
    },
    variants: [
      { id: 'blend-soft', label: 'Soft Blender', settings: { size: 58, opacity: 0.44, hardness: 0.06, flow: 0.34, smudgeLength: 0.48, smudgeRadius: 28, colorRate: 0.12, smudgeMode: 'dulling' } },
      { id: 'blend-finger', label: 'Finger Smudge', settings: { size: 34, hardness: 0.36, flow: 0.58, smudgeLength: 0.82, smudgeRadius: 15, colorRate: 0.04, smudgeMode: 'smearing', pressureSize: 0.56 } },
      { id: 'blend-bristle', label: 'Bristle Blender', settings: { size: 42, hardness: 0.48, flow: 0.5, smudgeLength: 0.7, smudgeRadius: 18, colorRate: 0.18, texture: 'hatch', textureScale: 0.7, textureDepth: 0.5, dualBrush: true } },
      { id: 'blend-palette', label: 'Palette Mix', settings: { size: 52, hardness: 0.58, flow: 0.62, smudgeLength: 0.66, smudgeRadius: 22, colorRate: 0.5, mixMode: 'spectral', smudgeMode: 'dulling', pressureColor: 0.56 } },
      { id: 'blend-loaded', label: 'Loaded Mixer', settings: { size: 44, opacity: 0.9, hardness: 0.54, flow: 0.72, smudgeLength: 0.58, smudgeRadius: 20, colorRate: 0.72, mixMode: 'spectral', pressureFlow: 0.64 } },
      { id: 'blend-pure-smear', label: 'Pure Smear', settings: { size: 30, opacity: 1, hardness: 0.42, flow: 0.8, smudgeLength: 0.94, smudgeRadius: 12, colorRate: 0, smudgeMode: 'smearing', pressureSize: 0.46 } },
      { id: 'blend-glaze-mixer', label: 'Glaze Mixer', settings: { size: 76, opacity: 0.24, hardness: 0.04, flow: 0.2, smudgeLength: 0.42, smudgeRadius: 30, colorRate: 0.28, mixMode: 'spectral', smudgeMode: 'dulling', pressureColor: 0.7 } },
      { id: 'blend-texture', label: 'Textured Smudge', settings: { size: 48, hardness: 0.3, flow: 0.42, smudgeLength: 0.74, smudgeRadius: 19, colorRate: 0.12, texture: 'canvas-grain', textureScale: 1, textureDepth: 0.54, dualBrush: true } },
      { id: 'blend-push-pull', label: 'Push-Pull Sculpt', settings: { size: 36, hardness: 0.64, flow: 0.58, roundness: 0.46, angleDeg: 18, smudgeLength: 0.78, smudgeRadius: 14, colorRate: 0.22, pressureSize: 0.68, tiltAngle: 0.8, tiltRoundness: 0.7, rotationFollowsTwist: true } },
    ],
  },
];

export const EXPANDED_BRUSH_PRESET_GROUPS = EXPANDED_BRUSH_FAMILIES.map((family) => family.group);

export const EXPANDED_IMAGE_BRUSH_PRESETS: ImageBrushPreset[] = EXPANDED_BRUSH_FAMILIES.flatMap(buildFamily);
