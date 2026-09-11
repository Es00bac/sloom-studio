import type { PaperComicSfxDesign } from '../lib/paperComicSfx';
import type { ManagedBundledFontFaceIssue, ManagedBundledFontFaceReference } from './managedFont';

export type EditorTool =
  | 'hand'
  | 'move'
  | 'marquee'
  | 'lasso'
  | 'magicWand'
  | 'pen'
  | 'brush'
  | 'eraser'
  | 'backgroundEraser'
  | 'magicEraser'
  | 'cloneStamp'
  | 'spotHeal'
  | 'blurBrush'
  | 'sharpenBrush'
  | 'smudgeBrush'
  | 'dodgeBrush'
  | 'burnBrush'
  | 'spongeSaturateBrush'
  | 'spongeDesaturateBrush'
  | 'paintBucket'
  | 'gradientTool'
  | 'rectShape'
  | 'ellipseShape'
  | 'crop'
  | 'text'
  | 'eyedropper';

export type MarqueeShape = 'rectangle' | 'ellipse';
export type LassoShape = 'freehand' | 'polygonal' | 'magnetic';

export type LayerType = 'image' | 'mask' | 'text' | 'adjustment' | 'vector' | 'group';
export type ImageLayerColorLabel = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'gray';

export interface ImageLayerLocks {
  pixels?: boolean;
  position?: boolean;
}

export type LayerEffectKind =
  | 'stroke'
  | 'bevelEmboss'
  | 'dropShadow'
  | 'innerShadow'
  | 'outerGlow'
  | 'innerGlow'
  | 'colorOverlay'
  | 'satin'
  | 'patternOverlay'
  | 'gradientOverlay';
export type LayerFilterKind = 'blur' | 'sharpen' | 'grayscale' | 'sepia' | 'invert' | 'noise' | 'pixelate' | 'denoise';
export type PatternOverlayPattern = 'checker' | 'diagonal' | 'dots' | 'grid';

export interface BaseLayerEffect {
  id: string;
  kind: LayerEffectKind;
  enabled: boolean;
}

export interface StrokeLayerEffect extends BaseLayerEffect {
  kind: 'stroke';
  color: string;
  opacity: number;
  size: number;
  position: 'outside' | 'inside' | 'center';
}

/** A compact, raster-native bevel. It deliberately models only the useful inner edge,
 * light direction, and highlight/shadow colours; Photoshop contour/texture controls are
 * not claimed as compatible. */
export interface BevelEmbossLayerEffect extends BaseLayerEffect {
  kind: 'bevelEmboss';
  highlightColor: string;
  shadowColor: string;
  opacity: number;
  angle: number;
  size: number;
}

export interface DropShadowLayerEffect extends BaseLayerEffect {
  kind: 'dropShadow';
  color: string;
  opacity: number;
  angle: number;
  distance: number;
  size: number;
}

export interface InnerShadowLayerEffect extends BaseLayerEffect {
  kind: 'innerShadow';
  color: string;
  opacity: number;
  angle: number;
  distance: number;
  size: number;
}

export interface OuterGlowLayerEffect extends BaseLayerEffect {
  kind: 'outerGlow';
  color: string;
  opacity: number;
  size: number;
}

export interface InnerGlowLayerEffect extends BaseLayerEffect {
  kind: 'innerGlow';
  color: string;
  opacity: number;
  size: number;
}

export interface ColorOverlayLayerEffect extends BaseLayerEffect {
  kind: 'colorOverlay';
  color: string;
  opacity: number;
}

export interface SatinLayerEffect extends BaseLayerEffect {
  kind: 'satin';
  color: string;
  opacity: number;
  angle: number;
  distance: number;
  size: number;
  invert: boolean;
}

export interface PatternOverlayLayerEffect extends BaseLayerEffect {
  kind: 'patternOverlay';
  color: string;
  backgroundColor: string;
  opacity: number;
  pattern: PatternOverlayPattern;
  scale: number;
}

export interface GradientOverlayLayerEffect extends BaseLayerEffect {
  kind: 'gradientOverlay';
  color: string;
  secondaryColor: string;
  opacity: number;
  angle: number;
  scale: number;
  reverse: boolean;
}

export type ImageLayerEffect =
  | StrokeLayerEffect
  | BevelEmbossLayerEffect
  | DropShadowLayerEffect
  | InnerShadowLayerEffect
  | OuterGlowLayerEffect
  | InnerGlowLayerEffect
  | ColorOverlayLayerEffect
  | SatinLayerEffect
  | PatternOverlayLayerEffect
  | GradientOverlayLayerEffect;

export interface ImageLayerFilter {
  id: string;
  kind: LayerFilterKind;
  enabled: boolean;
  amount: number;
  opacity: number;
  blendMode: BlendMode;
  /** Optional non-destructive per-filter alpha mask. Values are 0..255 row-major. */
  mask?: ImageLayerFilterMask;
}

export interface ImageLayerFilterMask {
  width: number;
  height: number;
  alpha: number[];
}

export type AdjustmentLayerKind =
  | 'brightnessContrast'
  | 'hueSaturation'
  | 'blackWhite'
  | 'invert'
  | 'exposure'
  | 'temperatureTint'
  | 'levels'
  | 'curves'
  | 'lut'
  | 'gradientMap'
  | 'channelMixer'
  | 'selectiveColor';

export type ImageAdjustmentSettings =
  | {
      kind: 'brightnessContrast';
      brightness: number;
      contrast: number;
    }
  | {
      kind: 'hueSaturation';
      hue: number;
      saturation: number;
      lightness: number;
    }
  | {
      kind: 'blackWhite';
    }
  | {
      kind: 'invert';
    }
  | {
      kind: 'exposure';
      exposure: number;
      offset: number;
      gamma: number;
    }
  | {
      kind: 'temperatureTint';
      temperature: number;
      tint: number;
    }
  | {
      kind: 'levels';
      channel: 'rgb' | 'red' | 'green' | 'blue';
      inputBlack: number;
      inputWhite: number;
      gamma: number;
      outputBlack: number;
      outputWhite: number;
    }
  | {
      kind: 'curves';
      channel: 'rgb' | 'red' | 'green' | 'blue';
      points: Array<{ input: number; output: number }>;
      shadows: number;
      midtones: number;
      highlights: number;
    }
  | {
      kind: 'lut';
      channel: 'rgb' | 'red' | 'green' | 'blue';
      lutData?: Uint8ClampedArray;
      /** JSON-safe persisted representation used by project save/reopen. */
      lutDataValues?: number[];
    }
  | {
      kind: 'gradientMap';
      stops: Array<{ position: number; color: [number, number, number] }>;
    }
  | {
      kind: 'channelMixer';
      red: [number, number, number];
      green: [number, number, number];
      blue: [number, number, number];
      constant: [number, number, number];
    }
  | {
      kind: 'selectiveColor';
      target: 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'whites' | 'neutrals' | 'blacks';
      cyan: number;
      magenta: number;
      yellow: number;
      black: number;
    };

/** "This Layer" tonal range controls. The bounded implementation intentionally
 * excludes the Photoshop "Underlying Layer" split sliders. */
export interface ImageLayerBlendIf {
  sourceBlack: number;
  sourceWhite: number;
}

export interface ImageLayerCompLayerState {
  layerId: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
}

export interface ImageLayerComp {
  id: string;
  name: string;
  layers: ImageLayerCompLayerState[];
  createdAt: number;
}

export interface ImageSourceLinkMetadata {
  id: string;
  label?: string;
  width?: number;
  height?: number;
  status: 'linked' | 'missing' | 'relinked';
  relinkHistory: Array<{ sourceId: string; label?: string; at: number }>;
}

export interface ImageTiltmarkPaperTopology {
  seed: number;
  scalePx: number;
  roughness: number;
  octaves: number;
  toothAngleRad: number;
  toothAspect: number;
  fibreTransportVersion?: number;
  fibreDirection?: 'x' | 'y';
  fibreAnisotropy?: number;
}

export interface ImageTiltmarkSurfaceProfile {
  schemaVersion: 1;
  presetId: string;
  name: string;
  type: 'paper' | 'canvas' | 'synthetic';
  absorbency: number;
  sizing: number;
  roughness: number;
  stainResponse: number;
  liftResponse: number;
  dryingMultiplier: number;
  topology: ImageTiltmarkPaperTopology;
}

export interface ImageTiltmarkLayerMetadata {
  schemaVersion: 1;
  role: 'group' | 'surface';
  /** Physical surface settings exist only on the editable surface child. */
  surface?: ImageTiltmarkSurfaceProfile;
  materialState?: 'empty' | 'physical';
  strokeCount?: number;
  lastPresetId?: string;
  simulation?: {
    format: 'tiltmark-substrate';
    version: 1;
    byteLength: number;
    tileCount: number;
    stepCount: number;
    evolvingTileCount: number;
    updatedAt: number;
  };
}

export interface ImageLayerMetadata {
  editableText?: boolean;
  /** A text layer just dropped by the Type tool, not yet committed with content. */
  freshlyPlaced?: boolean;
  comicSfxDesign?: PaperComicSfxDesign;
  retouchOutput?: {
    sourceLayerId: string;
    tool: 'dodge' | 'burn' | 'spongeSaturate' | 'spongeDesaturate';
    outputMode: 'newLayer';
  };
  smartLinkedSourceId?: string;
  sourceLabel?: string;
  sourceLink?: ImageSourceLinkMetadata;
  sourceFormat?: string;
  sourceMimeType?: string;
  sourceWarnings?: string[];
  originalSvgSource?: string;
  vectorShape?: ImageVectorShape;
  vectorBooleanSource?: {
    operation: 'union' | 'intersect' | 'subtract' | 'xor';
    sourceLayerIds: string[];
    supportedSubset: 'axis-aligned-rectangles' | 'identical-simple-polygons' | 'non-overlapping-simple-polygons' | 'overlapping-simple-polygons' | 'none';
    previewSignature: string;
  };
  /**
   * Tiltmark layers remain ordinary transparent image layers to the compositor,
   * but retain physical surface intent and simulation state like a smart object.
   */
  tiltmark?: ImageTiltmarkLayerMetadata;
}

/** A retained document-owned source behind one or more Smart Object instances. The bytes travel
 * as a separately integrity-checked `.slimg` asset; no source data URL is retained in document JSON. */
export interface SmartSource {
  id: string;
  kind: 'embedded' | 'linked';
  mimeType: string;
  byteLength: number;
  sha256: string;
  nativeWidth: number;
  nativeHeight: number;
  label: string;
  version: number;
  bytesAssetId?: string;
  /** Runtime authority until `.slimg` moves it into the separately hashed asset table. */
  embeddedBytes?: Uint8Array;
  nested?: ImageDocument;
  linked?: { sourceLibraryItemId: string };
}

export interface ImageSmartObjectPlacement {
  width: number;
  height: number;
}

export interface ImageSmartObjectInstance {
  sourceId: string;
  placement: ImageSmartObjectPlacement;
  renderedVersion: number;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';
export type QuickMaskViewMode = 'maskedAreas' | 'selectedAreas';
export type SelectAndMaskPreviewMode = 'maskedAreas' | 'selectedAreas' | 'onBlack' | 'onWhite' | 'blackWhite';
export type SelectAndMaskOutputMode = 'selection' | 'quickMask' | 'layerMask' | 'newAlphaChannel';
export type ImageLayerEditTarget = 'layer' | 'mask';
export type ImageColorChannel = 'rgb' | 'red' | 'green' | 'blue';
export type ImageColorChannelComponent = Exclude<ImageColorChannel, 'rgb'>;

export interface ImageChannelEditTarget {
  kind: 'colorChannel';
  channel: ImageColorChannel;
  components: ImageColorChannelComponent[];
}

export type ImageLayerTransformCorner = 'nw' | 'ne' | 'se' | 'sw';

export interface ImageTransformPoint {
  x: number;
  y: number;
}

export interface ImageLayerTransformCornerOffsets {
  nw: ImageTransformPoint;
  ne: ImageTransformPoint;
  se: ImageTransformPoint;
  sw: ImageTransformPoint;
}

export interface ImageLayerWarpOffsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** One control-point displacement in a warp mesh, normalized to layer width/height. */
export interface WarpMeshPoint {
  x: number;
  y: number;
}

/** A Photoshop-style warp control mesh: an (columns+1)×(rows+1) grid of displacements. */
export interface WarpMesh {
  columns: number;
  rows: number;
  /** (rows+1)×(columns+1) node displacements, row-major. */
  points: WarpMeshPoint[];
}

export type BrushSymmetryMode = 'none' | 'vertical' | 'horizontal' | 'both';

/** A single control point of a brush response curve (input/output both 0..1). */
export interface BrushCurvePoint {
  x: number;
  y: number;
}

/** Named response-curve shapes (resolved to control points by the brush engine). */
export type BrushResponseCurvePreset = 'linear' | 'soft' | 'hard' | 'sshape';

/** A pressure/sensor response curve: a named preset or explicit control points. */
export type BrushResponseCurve = BrushResponseCurvePreset | BrushCurvePoint[];

/** Image exposes two independent mark generators; backend acceleration is configured separately. */
export type ImageBrushEngineId = 'studio' | 'tiltmark';

/** Physical bristle-bundle model overrides (engine BristlePhysicalModel wire shape). */
export interface TiltmarkBristlePhysicalOverrides {
  fibreMaterial?: 'sable' | 'hog' | 'synthetic' | 'sponge';
  ferruleWidthScale?: number;
  ferruleDepthScale?: number;
  bellyScale?: number;
  fibreLength?: { mean?: number; variation?: number };
  fibreDiameter?: { mean?: number; variation?: number };
  absorption?: number;
  wicking?: number;
  retention?: number;
  release?: number;
}

/**
 * Tip geometry overrides merged over the active catalog preset's tip. Every
 * field optional; unknown-for-the-kind fields are ignored by the engine.
 */
export interface TiltmarkTipOverrides {
  aspect?: number;
  authoredAngleRad?: number;
  cornerRadius?: number;
  sideContactStart?: number;
  sideContactFull?: number;
  shoulderScale?: number;
  grain?: number;
  stiffness?: number;
  strandCount?: number;
  damping?: number;
  drag?: number;
  rake?: number;
  splay?: number;
  cohesion?: number;
  rotationFollowsTwist?: boolean;
  profile?: 'round' | 'flat' | 'filbert';
  spread?: number;
  count?: number;
  wave?: number;
  physical?: TiltmarkBristlePhysicalOverrides;
}

/** One generic sensor→dynamics routing (engine BrushSensorMapping wire shape). */
export interface TiltmarkSensorMappingOverride {
  source: 'tilt' | 'twist' | 'velocity';
  target:
    | 'spacing'
    | 'smoothing'
    | 'pressureSize'
    | 'pressureOpacity'
    | 'pressureFlow'
    | 'pressureColor'
    | 'tiltSize'
    | 'tiltOpacity'
    | 'tiltColor'
    | 'loadFalloff'
    | 'scatter'
    | 'sizeJitter'
    | 'opacityJitter'
    | 'angleJitter';
  inputMin?: number;
  inputMax?: number;
  outputMin?: number;
  outputMax?: number;
  curve?: BrushResponseCurve;
  mode?: 'multiply';
}

export interface TiltmarkPathStabilizationOverrides {
  responseTimeMs?: number;
  maxLagPx?: number;
  catchUpOnEnd?: boolean;
}

export interface TiltmarkStrokeTaperOverrides {
  startDistancePx?: number;
  endDistancePx?: number;
  startSizeScale?: number;
  endSizeScale?: number;
  startTransferScale?: number;
  endTransferScale?: number;
}

export interface TiltmarkStationaryDepositionOverrides {
  intervalMs?: number;
  maxDurationMs?: number;
  sizeScale?: number;
  transferScale?: number;
}

export interface TiltmarkSprayNozzleOverrides {
  cap?: 'fat' | 'soft' | 'precision' | 'calligraphy';
  nearDistancePx?: number;
  farDistancePx?: number;
  activationMaxDistancePx?: number;
  output?: number;
}

export interface TiltmarkSprayMaterialOverrides {
  pigmentFraction?: number;
  solventFraction?: number;
  viscosity?: number;
  solventDiffusion?: number;
  solventEvaporation?: number;
  cureRate?: number;
  poolingThreshold?: number;
  edgePooling?: number;
}

export interface TiltmarkReservoirPolicyOverrides {
  reloadPolicy?: 'per-stroke' | 'persistent';
  colorPolicy?: 'reload' | 'preserve-contamination';
}

/**
 * Artist overrides merged onto the active Tiltmark catalog preset by
 * resolveTiltmarkPreset. Sparse by contract: absent keys mean "catalog value",
 * which keeps per-preset defaults and adjusted-count badges meaningful.
 * reservoirPolicy and recipe are consumed at runtime call sites rather than
 * merged into the preset payload sent to Rust.
 */
export interface TiltmarkBrushOverrideSettings {
  tip?: TiltmarkTipOverrides;
  vehicleLoad?: number;
  pigmentRefillRatio?: number;
  vehicleRefillRatio?: number;
  sensorMappings?: TiltmarkSensorMappingOverride[];
  pathStabilization?: TiltmarkPathStabilizationOverrides;
  strokeTaper?: TiltmarkStrokeTaperOverrides;
  stationaryDeposition?: TiltmarkStationaryDepositionOverrides;
  tool?: {
    nozzle?: TiltmarkSprayNozzleOverrides;
    material?: TiltmarkSprayMaterialOverrides;
  };
  reservoirPolicy?: TiltmarkReservoirPolicyOverrides;
  /** Medium recipe constant overrides keyed by engine recipe field. */
  recipe?: Record<string, number | string>;
}

/**
 * Device-level stylus calibration (engine StylusResponseProfile wire shape).
 * Applied to every sample before brush dynamics; independent of the preset.
 */
export interface TiltmarkStylusProfileSettings {
  pressureCurve?: BrushResponseCurve;
  tiltCurve?: BrushResponseCurve;
  pressureFloor?: number;
  pressureCeiling?: number;
  tiltFloor?: number;
  tiltCeiling?: number;
  azimuthOffsetDeg?: number;
  twistOffsetDeg?: number;
  invertAzimuth?: boolean;
  invertTwist?: boolean;
  twistFallbackMode?: 'brush-default' | 'manual' | 'tilt-compensated';
  manualTwistDeg?: number;
  tiltTwistGain?: number;
}

/** Wet-media substrate solver v3 controls (engine wire shape; Rust sanitizes). */
export interface TiltmarkWetPhysicsControls {
  surfaceFlowRate?: number;
  surfaceViscosity?: number;
  paperHeightHead?: number;
  contactLinePinningRate?: number;
  paperCapacity?: number;
  uptakeRate?: number;
  poreWickingRate?: number;
  dryPoreConductivity?: number;
  edgeEvaporation?: number;
  waterPoreEvaporationRatio?: number;
  solventPoreEvaporationRatio?: number;
  pigmentFiltration?: number;
}

export interface BrushSettings {
  /** Existing Image dab engine remains the default and Community-edition engine. */
  brushEngine?: ImageBrushEngineId;
  presetId?: string;
  /** Active preset in the separately licensed Tiltmark catalog. */
  tiltmarkPresetId?: string;
  /** Tiltmark physical/material overrides retained independently from Studio-engine wet controls. */
  tiltmarkWetness?: number;
  tiltmarkSolvent?: number;
  tiltmarkPickup?: number;
  tiltmarkGrain?: number;
  tiltmarkInteraction?: 'paint' | 'smudge' | 'mix' | 'lift';
  /** Carry a wet implement's finite pigment/vehicle supply between strokes. */
  tiltmarkPersistentSupply?: boolean;
  /** Deep artist overrides merged over the active Tiltmark catalog preset. */
  tiltmarkOverrides?: TiltmarkBrushOverrideSettings;
  /** Device-level stylus calibration applied before brush dynamics. */
  tiltmarkStylusProfile?: TiltmarkStylusProfileSettings;
  /** Wet-media substrate solver v3 controls applied to every Tiltmark surface. */
  tiltmarkWetPhysics?: TiltmarkWetPhysicsControls;
  /** Global substrate evaporation-rate multiplier (engine-clamped). */
  tiltmarkEvaporationRate?: number;
  size: number;
  opacity: number;
  hardness: number;
  flow: number;
  color: string;
  spacing: number;
  angleDeg: number;
  roundness: number;
  scatter: number;
  smoothing: number;
  pressureSize: number;
  pressureOpacity: number;
  pressureFlow: number;
  /**
   * Pressure response curve. Remaps pen pressure through a transfer function
   * before it drives size/opacity/flow (Krita pressure curve / Photoshop
   * transfer). Defaults to 'linear' (identity) — no change unless configured.
   */
  pressureCurve?: BrushResponseCurve;
  /** Pressure → tip roundness (0..1): light pressure flattens the tip, full pressure restores it. */
  pressureRoundness?: number;
  /** Pressure → edge hardness (0..1): light pressure softens the edge, full pressure restores it. */
  pressureHardness?: number;
  /** Stylus tilt → brush angle steering (0..1). */
  tiltAngle?: number;
  /** Stylus tilt → tip flattening / elongation (0..1). */
  tiltRoundness?: number;
  /** Stylus tilt → footprint growth (0..1). */
  tiltSize?: number;
  /** Stylus tilt → opacity reduction (0..1): more tilt lays down lighter (pencil/charcoal shading). */
  tiltOpacity?: number;
  /** Stylus tilt → flow reduction (0..1): more tilt deposits less paint per dab. */
  tiltFlow?: number;
  /** Barrel rotation (twist) rotates the tip. */
  rotationFollowsTwist?: boolean;
  /** Pressure → blend the dab colour from the foreground toward the background (0..1). */
  pressureColor?: number;
  /** Tilt → blend the dab colour from the foreground toward the background (0..1). */
  tiltColor?: number;
  /** Color-smudge / mixer mode: brush also samples + mixes the canvas it passes over. */
  mixerEnabled?: boolean;
  /** Mixer: how much the picked-up colour persists/drags (0..1). */
  smudgeLength?: number;
  /** Mixer: radius (px) of the canvas-sampling disc. */
  smudgeRadius?: number;
  /** Mixer: how much foreground colour is added per dab (0..1). 0 = pure smudge. */
  colorRate?: number;
  /** Mixer colour blending: 'rgb' (default) or 'spectral' (realistic pigment). */
  mixMode?: 'rgb' | 'spectral';
  /** Mixer sampling: 'dulling' (average disc) or 'smearing' (streaky drag). */
  smudgeMode?: 'dulling' | 'smearing';
  tipShape: 'round' | 'square';
  symmetryMode?: BrushSymmetryMode;
  velocitySize?: number;
  velocityOpacity?: number;
  velocityFlow?: number;
  velocitySpacing?: number;
  /**
   * Shape/Transfer "jitter": per-dab deterministic randomization (seeded from the
   * stroke seed). Each value 0..1 is the maximum fraction by which that property is
   * randomly reduced per dab. 0 = off. Same seed → identical dabs (reproducible).
   */
  sizeJitter?: number;
  opacityJitter?: number;
  flowJitter?: number;
  roundnessJitter?: number;
  /** Angle jitter: per-dab random tip rotation, 0..1 scaled to ±180°. 0 = off. */
  angleJitter?: number;
  /** Dry-brush / taper: fade dab opacity in over the first N dabs of a stroke (0 = off). */
  fadeLength?: number;
  /** Dry-brush paint load 0..1 (how much "paint" the brush starts with). Default 1 = full. */
  paintLoad?: number;
  /** Dry-brush load depletion rate per pixel of stroke distance (0 = never runs out). */
  loadFalloff?: number;
  texture?: string;
  textureScale?: number;
  textureDepth?: number;
  dualBrush?: boolean;
  wetEdges?: boolean;
  wetMedia?: boolean;
  wetMix?: number;
  wetLoad?: number;
  wetPull?: number;
  gpuBrushEngine?: boolean;
  gpuAcceleration?: boolean;
  androidBrushControls?: boolean;
  androidStylusControls?: boolean;
  gamepadBrushControls?: boolean;
  gamepadPressure?: boolean;
  abrSourceHash?: string;
  abrPresetId?: string;
  abrVersion?: number;
}

export interface SelectionToolSettings {
  mode: SelectionMode;
  feather: number;
  antiAlias: boolean;
  marqueeShape: MarqueeShape;
  lassoShape: LassoShape;
  magneticSnapRadius?: number;
  magneticContrastThreshold?: number;
  magicWandTolerance: number;
  sampleAllLayers: boolean;
  contiguous: boolean;
  paintBucketBlendMode: BlendMode;
  paintBucketPreserveTransparency: boolean;
  backgroundEraserTolerance?: number;
  backgroundEraserContiguous?: boolean;
  backgroundEraserSampling?: 'once' | 'continuous';
  backgroundEraserUseBackgroundSwatch?: boolean;
  backgroundEraserLimits?: 'contiguous' | 'discontiguous';
  backgroundEraserProtectForeground?: boolean;
}

export type RetouchSampleMode = 'currentLayer' | 'currentAndBelow' | 'allLayers';
export type RetouchToneRange = 'all' | 'shadows' | 'midtones' | 'highlights';

export interface RetouchToolSettings {
  sampleMode: RetouchSampleMode;
  aligned: boolean;
  outputMode: 'activeLayer' | 'newLayer';
  toneRange: RetouchToneRange;
  protectTones: boolean;
  spongeVibrance: number;
  spongePreserveLuminosity: boolean;
  airbrush: boolean;
  rate: number;
}

export interface QuickMaskSettings {
  enabled: boolean;
  viewMode: QuickMaskViewMode;
  overlayOpacity: number;
}

export interface SelectAndMaskSettings {
  enabled: boolean;
  previewMode: SelectAndMaskPreviewMode;
  smooth: number;
  feather: number;
  contrast: number;
  shiftEdge: number;
  refineRadius: number;
  decontaminateColors: boolean;
  decontaminateAmount: number;
  outputMode: SelectAndMaskOutputMode;
}

export type GradientToolMode = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
export type GradientToolColorMode = 'foregroundToTransparent' | 'foregroundToBackground' | 'multiStop';
export type VectorShapeKind = 'rect' | 'ellipse' | 'path';

export interface GradientToolColorStop {
  offset: number;
  color: string;
  opacity?: number;
}

export interface GradientToolPreset {
  id: string;
  label: string;
  colorStops: GradientToolColorStop[];
}

export interface GradientToolSettings {
  mode: GradientToolMode;
  colorMode: GradientToolColorMode;
  reverse: boolean;
  dither: boolean;
  presetId?: string;
  colorStops?: GradientToolColorStop[];
}

export type CustomVectorShapePresetKind = 'line' | 'triangle' | 'diamond' | 'polygon' | 'star';
export type ShapeToolPresetKind = 'rect' | CustomVectorShapePresetKind;

export interface CustomVectorShapePreset {
  kind: CustomVectorShapePresetKind;
  polygonSides?: number;
  starInnerRadius?: number;
}

export interface VectorShapeStyle {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export interface ShapeToolSettings extends VectorShapeStyle {
  presetKind: ShapeToolPresetKind;
  polygonSides: number;
  starInnerRadius: number;
}

export interface ImageVectorPathPoint {
  x: number;
  y: number;
  inHandle?: {
    x: number;
    y: number;
  };
  outHandle?: {
    x: number;
    y: number;
  };
}

export interface TextLayerPathReferenceMetadata {
  kind: 'vector-layer' | 'svg-path' | 'external-path';
  layerId?: string;
  pathId?: string;
  revision?: number;
  sourceId?: string;
}

export interface TextLayerBezierSegment {
  from: ImageVectorPathPoint;
  control1: ImageVectorPathPoint;
  control2: ImageVectorPathPoint;
  to: ImageVectorPathPoint;
}

export interface TextLayerPathLayout {
  sourceLayerId?: string;
  geometry?: 'straight-segment-path' | 'bezier-sampled-path';
  points: ImageVectorPathPoint[];
  bezierSegments?: TextLayerBezierSegment[];
  closed: boolean;
  startOffset: number;
  reverse: boolean;
  pathLength: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  previewSignature: string;
}

export interface ImageVectorShapeBase extends VectorShapeStyle {
  width: number;
  height: number;
}

export interface ImageRectVectorShape extends ImageVectorShapeBase {
  kind: 'rect';
}

export interface ImageEllipseVectorShape extends ImageVectorShapeBase {
  kind: 'ellipse';
}

export interface ImagePathVectorShape extends ImageVectorShapeBase {
  kind: 'path';
  points: ImageVectorPathPoint[];
  closed: boolean;
  preset?: CustomVectorShapePreset;
  /** A derived path that recomputes from two editable retained operands. */
  liveBoolean?: {
    version: 1;
    operation: 'union' | 'intersect' | 'subtract' | 'xor';
    sourceLayerIds: [string, string];
    outputIndex: number;
  };
}

export type ImageVectorShape =
  | ImageRectVectorShape
  | ImageEllipseVectorShape
  | ImagePathVectorShape;

export type CropAspectPreset =
  | 'free'
  | 'original'
  | '1:1'
  | '4:3'
  | '3:2'
  | '4:5'
  | '16:9'
  // User-saved custom aspect ratios, encoded as `custom:<width/height>`.
  | `custom:${number}`;
export type CropGuideMode = 'none' | 'thirds' | 'grid';

export type CropToolMode = 'rectangular' | 'perspective';

export interface CropToolSettings {
  aspectPreset: CropAspectPreset;
  guideMode: CropGuideMode;
  deleteCroppedPixels: boolean;
  /**
   * When enabled, a destructive straightened crop locally repairs transparent
   * pixels in the active raster layer before the single crop history entry is
   * recorded. It intentionally remains opt-in because it bakes pixels.
   */
  cornerFillMode?: 'transparent' | 'content-aware';
  rotationDeg: number;
  /** Interactive crop flavor; `rectangular` keeps the classic drag-rect workflow. */
  mode: CropToolMode;
}

export interface TextLayerOpenTypeFeatures {
  enabled: string[];
  disabled: string[];
  unsupported?: string[];
}

export interface TextLayerStyle {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: 'normal' | 'italic' | 'oblique';
  managedFace?: ManagedBundledFontFaceReference;
  managedFaceIssue?: ManagedBundledFontFaceIssue;
  fontKerning: 'auto' | 'normal' | 'none';
  fontVariantCaps: 'normal' | 'small-caps' | 'all-small-caps';
  letterSpacing: number;
  baselineShift: number;
  boxWidth: number | null;
  boxHeight: number | null;
  wrap: boolean;
  color: string;
  lineHeight: number;
  align: 'left' | 'center' | 'right' | 'justify';
  verticalAlign: 'top' | 'middle' | 'bottom';
  orientation?: 'horizontal' | 'vertical-rl' | 'vertical-lr';
  warp: 'none' | 'arc' | 'flag' | 'bulge';
  openTypeFeatures?: TextLayerOpenTypeFeatures;
  pathReference?: TextLayerPathReferenceMetadata | null;
  pathLayout?: TextLayerPathLayout | null;
}

/**
 * Opaque pixel buffer for a layer. In the browser this is an OffscreenCanvas.
 * Helpers for cloning, blitting, etc. live in `src/components/ImageEditor/LayerBitmap.ts`.
 * Tests can use `null` where bitmap content isn't relevant.
 */
export type LayerBitmap = OffscreenCanvas;

// ---- MH-009 (Lane A A1) — high-bit pixel authority ----
/** Working pixel depth. u8/u16 are sRGB-encoded; f32 is linear scene-referred. */
export type PixelDepth = 'u8' | 'u16' | 'f32';
export type PixelColorModel = 'rgb' | 'cmyk' | 'gray';
export type PixelBufferData = Uint8Array | Uint16Array | Float32Array;

/** MH-010 native process-color authority. Kept separate from MH-009's RGB PixelBuffer contract. */
export interface ImageCmykPixelBuffer {
  model: 'cmyk';
  depth: 'u8';
  width: number;
  height: number;
  /** Interleaved C, M, Y, K, alpha samples; 0 = no ink, 255 = full coverage. */
  data: Uint8Array;
}

export interface ImageCmykDocumentMetadata {
  profileId: string;
  profileLabel: string;
  profileSource?: { kind: 'bundled'; id: string } | { kind: 'imported'; assetId: string; sha256: string };
  /** Base64 ICC bytes for imported profiles; bundled profiles are resolved by profileId. */
  profileBytesData?: string;
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute';
  blackPointCompensation: boolean;
  paperWhiteSimulation?: boolean;
}

/**
 * Canvas-free per-layer pixel authority (interleaved RGBA, straight alpha).
 * Authority when `ImageDocument.metadata.bitDepth` is not 8; the 8-bit
 * OffscreenCanvas `bitmap` is then a derived display proxy. Ordinary 8-bit
 * RGB documents never allocate `pixels`.
 */
export interface PixelBuffer {
  width: number;
  height: number;
  model: PixelColorModel;
  depth: PixelDepth;
  data: PixelBufferData;
}
// ---- end MH-009 (Lane A A1) pixel authority ----

export interface ImageLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  locks?: ImageLayerLocks;
  opacity: number;
  blendMode: BlendMode;
  blendIf?: ImageLayerBlendIf;
  x: number;
  y: number;
  rotationDeg?: number;
  skewXDeg?: number;
  skewYDeg?: number;
  perspectiveX?: number;
  perspectiveY?: number;
  warp?: ImageLayerWarpOffsets;
  /** Photoshop-style interactive warp: a grid of normalized control-point displacements. */
  warpMesh?: WarpMesh | null;
  cornerOffsets?: ImageLayerTransformCornerOffsets;
  transformOriginX?: number;
  transformOriginY?: number;
  bitmap: LayerBitmap | null;
  bitmapVersion: number;
  /** Identity-bearing instance record. The layer bitmap is only the current render cache. */
  smartObject?: ImageSmartObjectInstance;
  /** Temporary C1→C3 PSD bridge. C3 owns the interchange schema and writer. */
  smartObjectPsd?: unknown;
   /**
    * MH-009: high-bit pixel authority. Present only when the document working
   * depth (`metadata.bitDepth`) is 16 or 32; `bitmapVersion` this authority
   * was last derived from is tracked in `pixelsVersion`.
   */
   pixels?: PixelBuffer | null;
   pixelsVersion?: number;
   /** MH-010 CMYKA authority; never interpreted as an RGBA PixelBuffer. */
   cmykPixels?: ImageCmykPixelBuffer | null;
   cmykPixelsData?: string;
  mask: LayerBitmap | null;
  /**
   * A non-destructive reference to another layer's raster mask. Linked consumers own no
   * duplicate mask bitmap: composition resolves this id to the source layer's current mask.
   */
  maskLinkSourceLayerId?: string;
  /**
   * Serialized pixel payloads (base64 PNG data URLs), present only while a project document is
   * written to / read from disk (.sloom / .slimg). `bitmap`/`mask` are live OffscreenCanvas
   * buffers that can't be JSON-serialized; these carry the actual pixels across a save so the
   * active canvas survives, and are cleared back to undefined once decoded into `bitmap`/`mask`.
   */
  bitmapData?: string | null;
  maskData?: string | null;
  /**
   * MH-009 project transport for the high-bit pixel authority: bounded base64
   * little-endian samples. Only present while a project document is written
   * to / read from disk, exactly like `bitmapData`.
   */
  pixelsData?: string | null;
  /**
   * Static/fibre-bound pixels below a Tiltmark substrate preview. Kept separate
   * so a changing wet field can be recomposited without painting over itself.
   */
  tiltmarkBaseBitmap?: LayerBitmap | null;
  tiltmarkBaseBitmapData?: string | null;
  /**
   * Bounded gzip+JSON Tiltmark substrate checkpoint. It is transported as a
   * separate asset by .slimg and live sync rather than riding inside JSON ops.
   */
  tiltmarkSimulationData?: string | null;
  maskDensity?: number;
  maskFeather?: number;
  text?: TextLayerStyle;
  adjustment?: ImageAdjustmentSettings;
  effects?: ImageLayerEffect[];
  filters?: ImageLayerFilter[];
  colorLabel?: ImageLayerColorLabel;
  clippingMask?: boolean;
  groupId?: string;
  groupExpanded?: boolean;
  /**
   * Folder-only compositing mode. A pass-through folder composites its children directly
   * into the parent stack; an absent/false value isolates the folder before applying its
   * opacity and blend mode. Kept separate from blendMode so an isolated group can use a
   * real blend mode without being mistaken for pass-through.
   */
  groupPassThrough?: boolean;
  linkGroupId?: string;
  metadata?: ImageLayerMetadata;
  vectorRecipe?: string;
}

export interface DocumentViewport {
  zoom: number;
  panX: number;
  panY: number;
  /** Non-destructive canvas view rotation in degrees, normalized to (-180, 180]. Absent/0 = upright. */
  rotationDeg?: number;
}

export type ImageColorProofMode = 'rgb' | 'grayscale-soft-proof' | 'cmyk-soft-proof';
export type ImageColorProofIntent = 'screen-rgb' | 'grayscale-luminance' | 'relative-colorimetric' | 'perceptual';
export type ImageArtboardPagePreset = 'custom' | 'us-letter' | 'us-legal' | 'tabloid' | 'a4' | 'a5' | 'comic-book';

export interface ImageColorProofMetadata {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  profileLabel?: string;
}

export interface ImageArtboardPageMetadata {
  preset: ImageArtboardPagePreset;
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  dpi: number;
}

export interface ImageArtboardMetadata {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  proofLabel?: string;
  page: ImageArtboardPageMetadata;
}

export interface ImageArtboardsMetadata {
  activeArtboardId?: string;
  artboards: ImageArtboardMetadata[];
}

/** A single ruler guide line. `axis: 'x'` is a vertical guide at document x = position. */
export interface ImageGuide {
  id: string;
  axis: 'x' | 'y';
  position: number;
}

/**
 * Marks an image document as a LINKED EDIT of content owned by another workspace.
 * Closing the document's tab (or "Save & Return") flattens it and hands the result
 * back to its origin automatically — a Paper image frame, or a Flow .slimg node's
 * file — instead of the manual save-then-refresh dance.
 */
export type ImageDocumentLinkedEdit =
  | {
      kind: 'paper-frame';
      pageId: string;
      frameId: string;
      /** Label of the source item the frame held when the edit began (for naming the result). */
      sourceLabel: string;
    }
  | {
      kind: 'slimg-node';
      /** Absolute .slimg path the Flow node owns; the return overwrites this file. */
      filePath: string;
    }
  | {
      kind: 'smart-object';
      parentDocId: string;
      sourceId: string;
    };

export interface ImageDocument {
  id: string;
  title: string;
  width: number;
  height: number;
  layers: ImageLayer[];
  activeLayerId: string | null;
  /** Multi-selection for linked transforms; always includes activeLayerId. Absent = just the active layer. */
  selectedLayerIds?: string[];
  activeLayerEditTarget?: ImageLayerEditTarget;
  activeColorChannel?: ImageColorChannel;
  hasSelection: boolean;
  selectionVersion: number;
  /** Runtime/persistence handoff for an exact live selection; consumed into selectionRegistry on open/restore. */
  selectionMask?: SelectionMaskSnapshot;
  /** Project JSON transport for selectionMask.data. Never used as live selection state. */
  selectionMaskData?: string;
  viewport: DocumentViewport;
  guides?: ImageGuide[];
  /** Named visibility/opacity/blend-mode snapshots for returning to layer arrangements. */
  layerComps?: ImageLayerComp[];
  dirty: boolean;
  sourceBinItemId?: string;
  /** Present when this document round-trips back to Paper or a Flow .slimg node on close. */
  linkedEdit?: ImageDocumentLinkedEdit;
  savedSelectionChannels?: ImageSavedSelectionChannel[];
  /** Document-owned paths, detached from any vector layer; independent of the layer stack. */
  savedWorkPaths?: ImageSavedWorkPath[];
  spotChannels?: ImageSpotChannel[];
  metadata?: {
    sourceFormat?: string;
    sourceMimeType?: string;
    sourceBitDepth?: 8 | 16 | 32;
    /** MH-009 working depth of this document's raster pixel authorities. Absent means 8. */
    bitDepth?: 8 | 16 | 32;
    /** Native document working mode. Absent and `rgb` both mean RGB. */
    colorMode?: 'rgb' | 'cmyk';
    cmyk?: ImageCmykDocumentMetadata;
    warnings?: string[];
    colorProof?: ImageColorProofMetadata;
    artboards?: ImageArtboardsMetadata;
    animation?: ImageFrameAnimation;
    /** Document-owned Smart Object source graph. Bytes are stored by `bytesAssetId`, never JSON. */
    smartSources?: Record<string, SmartSource>;
  };
  snapshots?: ImageDocumentSnapshot[];
}

/** Bounded retained Image animation: frames store layer-visibility cels, not video media. */
export interface ImageAnimationFrame {
  id: string;
  name: string;
  durationMs: number;
  layerVisibility: Record<string, boolean>;
}

export interface ImageFrameAnimation {
  version: 1;
  frameRate: number;
  currentFrameId: string;
  onionSkin: { enabled: boolean; previousOpacity: number; nextOpacity: number };
  frames: ImageAnimationFrame[];
}

/** Ephemeral editor-only playback pointer. Lives outside document state on purpose: advancing
 * during playback must never touch dirty flags, history stacks, or anything persisted. */
export interface ImageAnimationPlaybackCursor {
  docId: string;
  frameId: string;
}

export interface ImageDocumentSnapshot {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  width: number;
  height: number;
  layers: ImageLayer[];
  activeLayerId: string | null;
  hasSelection: boolean;
  selectionVersion: number;
  /** Immutable alpha bytes owned by this named snapshot when hasSelection is true. */
  selectionMask?: SelectionMaskSnapshot;
  /** Project JSON transport for selectionMask.data. */
  selectionMaskData?: string;
  /** Complete snapshots own immutable bitmap/mask pixels; unavailable is a legacy/metadata-only record. */
  pixelState?: 'complete' | 'unavailable';
  /** Versioned structural and cryptographic content proof for every expected pixel payload. */
  integrity?: ImageDocumentSnapshotIntegrity;
}

export interface ImageDocumentSnapshotAssetIntegrity {
  present: boolean;
  width: number;
  height: number;
  /** SHA-256 over canonical role/layer/dimension metadata plus exact decoded pixel bytes. */
  contentDigest?: string;
}

export interface ImageDocumentSnapshotLayerIntegrity {
  layerId: string;
  bitmap: ImageDocumentSnapshotAssetIntegrity;
  mask: ImageDocumentSnapshotAssetIntegrity;
  /** Present only for retained Tiltmark surfaces; omitted by legacy/ordinary layers. */
  tiltmarkBase?: ImageDocumentSnapshotAssetIntegrity;
  /** Binds the editable physical checkpoint, not only its rendered preview. */
  tiltmarkSimulation?: {
    present: boolean;
    byteLength: number;
    contentDigest?: string;
  };
}

export interface ImageDocumentSnapshotIntegrity {
  version: 2;
  layers: ImageDocumentSnapshotLayerIntegrity[];
  selection: ImageDocumentSnapshotAssetIntegrity & { byteLength: number };
}

export interface SelectionMaskSnapshot {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ImageSavedSelectionChannel {
  id: string;
  name: string;
  width: number;
  height: number;
  dataBase64: string;
  createdAt: number;
}

/**
 * A document-owned path record independent of the vector layer stack, modeled on
 * Photoshop's Paths panel: exactly one 'work' entry may exist at a time (replaced
 * by the next unsaved path), while 'saved' entries persist until explicitly deleted.
 */
export interface ImageSavedWorkPath {
  id: string;
  name: string;
  kind: 'work' | 'saved';
  closed: boolean;
  points: ImageVectorPathPoint[];
  createdAt: number;
  updatedAt: number;
}

export interface ImageSpotChannelColor {
  r: number;
  g: number;
  b: number;
}

export interface ImageSpotChannel {
  id: string;
  name: string;
  width: number;
  height: number;
  color: ImageSpotChannelColor;
  opacity: number;
  solidity: number;
  visible: boolean;
  dataBase64: string;
  createdAt: number;
  updatedAt?: number;
}

export interface ImageQuickActionMacroStep {
  actionId: string;
}

export interface ImageQuickActionMacro {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  steps: ImageQuickActionMacroStep[];
}

export interface ImageLayerTransformState {
  x: number;
  y: number;
  rotationDeg?: number;
  skewXDeg?: number;
  skewYDeg?: number;
  perspectiveX?: number;
  perspectiveY?: number;
  warp?: ImageLayerWarpOffsets;
  /** Retained mesh control points must participate in transform history, not only rendering. */
  warpMesh?: WarpMesh | null;
  cornerOffsets?: ImageLayerTransformCornerOffsets;
  transformOriginX?: number;
  transformOriginY?: number;
}

export type EditorOperation =
  | {
      kind: 'paint';
      docId: string;
      layerId: string;
      paintTarget?: ImageLayerEditTarget;
      before: LayerBitmap | null;
      after: LayerBitmap | null;
      /**
       * Optional proprietary brush-state checkpoint paired with the raster
       * snapshot. Kept opaque here so the core Image history format does not
       * depend on, or eagerly import, a paid engine implementation.
       */
      tiltmarkHistory?: {
        before: unknown;
        after: unknown;
      };
      /** Editable Tiltmark surface state paired with the visible raster undo. */
      tiltmarkLayer?: {
        before: {
          base: LayerBitmap | null;
          simulationData?: string | null;
          metadata?: ImageLayerMetadata;
        };
        after: {
          base: LayerBitmap | null;
          simulationData?: string | null;
          metadata?: ImageLayerMetadata;
        };
      };
    }
  | {
      kind: 'selection';
      docId: string;
      before: SelectionMaskSnapshot | null;
      after: SelectionMaskSnapshot | null;
    }
  | {
      kind: 'transform';
      docId: string;
      layerId: string;
      before: ImageLayerTransformState;
      after: ImageLayerTransformState;
    }
  | {
      /** One gesture-level transform of several layers at once (multi-selection). */
      kind: 'multiTransform';
      docId: string;
      before: Record<string, ImageLayerTransformState>;
      after: Record<string, ImageLayerTransformState>;
    }
  | {
      kind: 'layerOp';
      docId: string;
      before: ImageLayer[];
      after: ImageLayer[];
    }
  | {
      kind: 'docResize';
      docId: string;
      before: { width: number; height: number; layers: ImageLayer[]; activeLayerId?: string | null };
      after: { width: number; height: number; layers: ImageLayer[]; activeLayerId?: string | null };
    }
  | {
      kind: 'documentState';
      docId: string;
      before: ImageDocument;
      after: ImageDocument;
    }
  | {
      /**
       * MH-009: one whole-document working-depth conversion (8↔16↔32). Stores
       * per-layer pixel authorities so undo/redo is bit-exact; canvases are
       * unchanged because an 8-bit-origin proxy round-trips every conversion.
       */
      kind: 'convertDepth';
      docId: string;
      before: {
        bitDepth: 8 | 16 | 32;
        layers: Record<string, { pixels: PixelBuffer | null; pixelsVersion: number | undefined }>;
      };
      after: {
        bitDepth: 8 | 16 | 32;
        layers: Record<string, { pixels: PixelBuffer | null; pixelsVersion: number | undefined }>;
      };
    }
  | {
      /** MH-009 A4: one native-depth authority edit, retained for ordinary bit-exact undo/redo. */
      kind: 'highBitPaint';
      docId: string;
      layerId: string;
      before: PixelBuffer;
      after: PixelBuffer;
      beforeVersion: number | undefined;
      afterVersion: number | undefined;
    };

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  brushEngine: 'studio',
  presetId: 'softRound',
  tiltmarkPresetId: 'graphite-2b',
  tiltmarkWetness: 0,
  tiltmarkSolvent: 0,
  tiltmarkPickup: 0,
  tiltmarkGrain: 0.6,
  tiltmarkInteraction: 'paint',
  tiltmarkPersistentSupply: true,
  size: 12,
  opacity: 1,
  hardness: 0.8,
  flow: 1,
  color: '#ffffff',
  spacing: 0.12,
  angleDeg: 0,
  roundness: 1,
  scatter: 0,
  smoothing: 0.15,
  pressureSize: 0.65,
  pressureOpacity: 0,
  pressureFlow: 0.35,
  pressureCurve: 'linear',
  tiltAngle: 0.7,
  tiltRoundness: 0.6,
  tiltSize: 0.2,
  rotationFollowsTwist: true,
  pressureColor: 0,
  tiltColor: 0,
  tipShape: 'round',
  symmetryMode: 'none',
  velocitySize: 0,
  velocityOpacity: 0,
  velocityFlow: 0,
  velocitySpacing: 0,
  texture: undefined,
  textureScale: 1,
  textureDepth: 0,
  dualBrush: false,
  wetEdges: false,
  wetMedia: false,
  wetMix: 0,
  wetLoad: 1,
  wetPull: 0,
  gpuBrushEngine: true,
  gpuAcceleration: true,
  androidBrushControls: false,
  androidStylusControls: false,
  gamepadBrushControls: false,
  gamepadPressure: false,
  abrSourceHash: undefined,
  abrPresetId: undefined,
  abrVersion: undefined,
};

export const DEFAULT_SELECTION_TOOL_SETTINGS: SelectionToolSettings = {
  mode: 'replace',
  feather: 0,
  antiAlias: true,
  marqueeShape: 'rectangle',
  lassoShape: 'freehand',
  magneticSnapRadius: 16,
  magneticContrastThreshold: 0.15,
  magicWandTolerance: 32,
  sampleAllLayers: true,
  contiguous: true,
  paintBucketBlendMode: 'normal',
  paintBucketPreserveTransparency: false,
  backgroundEraserTolerance: 32,
  backgroundEraserContiguous: true,
  backgroundEraserSampling: 'once',
  backgroundEraserUseBackgroundSwatch: false,
  backgroundEraserLimits: 'contiguous',
  backgroundEraserProtectForeground: false,
};

export const DEFAULT_RETOUCH_TOOL_SETTINGS: RetouchToolSettings = {
  sampleMode: 'currentLayer',
  aligned: true,
  outputMode: 'activeLayer',
  toneRange: 'midtones',
  protectTones: true,
  spongeVibrance: 0.65,
  spongePreserveLuminosity: true,
  airbrush: false,
  rate: 0.5,
};

export const DEFAULT_QUICK_MASK_SETTINGS: QuickMaskSettings = {
  enabled: false,
  viewMode: 'maskedAreas',
  overlayOpacity: 0.5,
};

export const DEFAULT_SELECT_AND_MASK_SETTINGS: SelectAndMaskSettings = {
  enabled: false,
  previewMode: 'maskedAreas',
  smooth: 0,
  feather: 0,
  contrast: 0,
  shiftEdge: 0,
  refineRadius: 0,
  decontaminateColors: false,
  decontaminateAmount: 0,
  outputMode: 'selection',
};

export const DEFAULT_GRADIENT_TOOL_SETTINGS: GradientToolSettings = {
  mode: 'linear',
  colorMode: 'foregroundToTransparent',
  reverse: false,
  dither: false,
};

export const STANDARD_GRADIENT_TOOL_PRESETS: GradientToolPreset[] = [
  {
    id: 'warm-sunset',
    label: 'Warm Sunset',
    colorStops: [
      { offset: 0, color: '#2d1b69', opacity: 1 },
      { offset: 0.35, color: '#f97316', opacity: 0.86 },
      { offset: 1, color: '#fde68a', opacity: 1 },
    ],
  },
  {
    id: 'cool-dawn',
    label: 'Cool Dawn',
    colorStops: [
      { offset: 0, color: '#0f172a', opacity: 1 },
      { offset: 0.52, color: '#38bdf8', opacity: 0.82 },
      { offset: 1, color: '#e0f2fe', opacity: 1 },
    ],
  },
  {
    id: 'neon-magenta-cyan',
    label: 'Neon Magenta / Cyan',
    colorStops: [
      { offset: 0, color: '#ff00aa', opacity: 1 },
      { offset: 0.5, color: '#7c3aed', opacity: 0.78 },
      { offset: 1, color: '#22d3ee', opacity: 1 },
    ],
  },
  {
    id: 'ink-wash',
    label: 'Ink Wash',
    colorStops: [
      { offset: 0, color: '#111827', opacity: 0.96 },
      { offset: 0.48, color: '#64748b', opacity: 0.58 },
      { offset: 1, color: '#f8fafc', opacity: 0.18 },
    ],
  },
];

export const DEFAULT_SHAPE_TOOL_SETTINGS: ShapeToolSettings = {
  fillColor: '#ffffff',
  fillOpacity: 1,
  strokeColor: '#000000',
  strokeOpacity: 1,
  strokeWidth: 0,
  presetKind: 'rect',
  polygonSides: 6,
  starInnerRadius: 0.5,
};

export const DEFAULT_CROP_TOOL_SETTINGS: CropToolSettings = {
  aspectPreset: 'free',
  guideMode: 'thirds',
  deleteCroppedPixels: false,
  cornerFillMode: 'transparent',
  rotationDeg: 0,
  mode: 'rectangular',
};

export const DEFAULT_TEXT_TOOL_SETTINGS: TextLayerStyle = {
  content: 'Text',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 48,
  fontWeight: '400',
  fontStyle: 'normal',
  fontKerning: 'auto',
  fontVariantCaps: 'normal',
  letterSpacing: 0,
  baselineShift: 0,
  boxWidth: null,
  boxHeight: null,
  wrap: true,
  color: '#ffffff',
  lineHeight: 1.15,
  align: 'left',
  verticalAlign: 'top',
  warp: 'none',
};

export const DEFAULT_VIEWPORT: DocumentViewport = {
  zoom: 1,
  panX: 0,
  panY: 0,
};
