/**
 * Sloom Studio (GPL) — data shapes for physical-media brush documents.
 *
 * The proprietary Tiltmark engine is not part of this repository. These types describe the
 * dab and preset records that Sloom documents and Hane link previews may carry so that such
 * files still open. No simulation is implemented here.
 */
export type TiltmarkInputKind = 'pen' | 'touch' | 'mouse' | 'native-android';

export type TiltmarkInteraction = 'paint' | 'smudge' | 'mix' | 'lift';

export type TiltmarkDabShape =
  | 'ellipse'
  | 'triangle'
  | 'chisel'
  | 'bristle'
  | 'particle'
  | 'ribbon';

export interface TiltmarkStylusPose {
  pressure: number;
  tangentialPressure: number;
  altitudeRad: number;
  azimuthRad: number;
  twistRad: number | null;
  distance: number;
  hasTilt: boolean;
  hasTwist: boolean;
  kind: TiltmarkInputKind;
  eraser: boolean;
}

export interface TiltmarkStylusSample {
  x: number;
  y: number;
  timeMs: number;
  pose: TiltmarkStylusPose;
}

export interface TiltmarkFibreContact {
  index: number;
  rootX: number;
  rootY: number;
  controlX: number;
  controlY: number;
  tipX: number;
  tipY: number;
  width: number;
  opacity: number;
  load: number;
  contactLength: number;
  color?: string | null;
}

export interface TiltmarkTipTexture {
  assetId: string;
  angleRad: number;
}

export interface TiltmarkGrainTexture {
  assetId: string;
  scalePx: number;
  depth: number;
  invert: boolean;
}

export interface TiltmarkBrushContactShade {
  darkX: number;
  darkY: number;
  lightX: number;
  lightY: number;
  darkAlpha: number;
  lightAlpha: number;
}

export interface TiltmarkBrushDab {
  index: number;
  x: number;
  y: number;
  /**
   * Inert preset metadata copied into the Rust render-plan input. Rust uses it
   * to author cohesive-film and fibre-detail commands; the host never
   * interprets the medium.
   */
  medium?: string;
  timeMs?: number;
  velocityPxPerMs?: number;
  pressure?: number;
  width: number;
  height: number;
  rotationRad: number;
  shape: TiltmarkDabShape;
  /** Rust-authored contact-light direction; renderers only present these stops. */
  contactShade?: TiltmarkBrushContactShade;
  chiselCornerRadius?: number;
  tipTexture?: TiltmarkTipTexture;
  grainTexture?: TiltmarkGrainTexture;
  color: string;
  opacity: number;
  /** Optional Rust-authored visible opacity when it differs from physical coverage. */
  renderOpacity?: number;
  flow: number;
  hardness: number;
  grain: number;
  wetness: number;
  solvent: number;
  strandCount: number;
  particleCount: number;
  spread: number;
  interaction: TiltmarkInteraction;
  pickup: number;
  contactFlow?: number;
  pickupCoverage?: number;
  substratePickupAmount?: number;
  substratePickupVehicleAmount?: number;
  substratePickupBodyVolume?: number;
  pigmentTransfer?: number;
  vehicleTransfer?: number;
  pigmentAmount?: number;
  physicalPigmentResolved?: boolean;
  vehicleAmount?: number;
  vehicleWater?: number;
  vehicleAqueousBinder?: number;
  vehicleSolvent?: number;
  vehicleOil?: number;
  vehicleAcrylic?: number;
  colorMix: number;
  bristleBend: number;
  bristleSplay: number;
  bristleCohesion: number;
  bristleRake?: number;
  bristleSide?: number;
  fibres?: TiltmarkFibreContact[];
  paintLoad: number;
  pigmentDemandPerPx?: number;
  seed: number;
  eraser: boolean;
}

export interface TiltmarkStrokeTelemetry {
  pressure: number;
  altitudeRad: number;
  azimuthRad: number;
  twistRad: number | null;
  velocityPxPerMs: number;
  sideContact: number;
}

export interface TiltmarkStrokeAppendResult {
  dabs: TiltmarkBrushDab[];
  telemetry: TiltmarkStrokeTelemetry;
}

export interface TiltmarkPhysicalTip {
  kind: 'graphite' | 'chisel' | 'bristle' | 'round' | 'particle' | 'ribbon';
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
  physical?: Record<string, unknown>;
}

export interface TiltmarkBrushPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  medium: string;
  tip: TiltmarkPhysicalTip;
  fixedPigment?: { name: string; color: string };
  color: string;
  sizePx: number;
  opacity: number;
  flow: number;
  hardness: number;
  spacing: number;
  smoothing: number;
  pressureCurve: 'linear' | 'soft' | 'hard' | 'sshape' | readonly { x: number; y: number }[];
  pressureSize: number;
  pressureOpacity: number;
  pressureFlow: number;
  pressureColor: number;
  tiltSize: number;
  tiltOpacity: number;
  tiltColor: number;
  wetness: number;
  solvent: number;
  interaction: TiltmarkInteraction;
  eraser: boolean;
  pickup: number;
  paintLoad: number;
  vehicleLoad: number;
  pigmentRefillRatio: number;
  vehicleRefillRatio: number;
  loadFalloff: number;
  grain: number;
  scatter: number;
  sizeJitter: number;
  opacityJitter: number;
  angleJitter: number;
  sensorMappings?: readonly Record<string, unknown>[];
  pathStabilization?: Record<string, unknown>;
  strokeTaper?: Record<string, unknown>;
  stationaryDeposition?: Record<string, unknown>;
  tipTexture?: Record<string, unknown>;
  grainTexture?: Record<string, unknown>;
  implementFamily?: string;
  implementDepictionKind?: string;
  accessoryFor?: string;
  tool?: {
    kind: 'spray-paint';
    [key: string]: unknown;
  };
}

/** Opaque engine handles; the engine is absent in this build. */
export type TiltmarkStrokeWasm = unknown;
export type TiltmarkWasmModule = unknown;
