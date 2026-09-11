/**
 * Pure geometry for stylus tilt + barrel rotation: normalizing raw PointerEvent fields
 * into a canonical {altitude, azimuth, twist} state, applying that to the brush tip
 * dynamics (angle / roundness / size), and producing the Krita-style 3D tip-preview
 * geometry. Kept canvas-free and tested so the engine and the overlay stay thin.
 *
 * Coordinate conventions:
 *  - altitudeDeg: 90 = pen upright (perpendicular to the tablet), 0 = pen laid flat.
 *  - azimuthDeg: 0..360, the compass direction the pen leans toward, 0 = +X (right),
 *    increasing clockwise on screen (since screen Y is down).
 *  - twistDeg: 0..360 barrel rotation reported by the pen.
 */

export interface PointerTiltInput {
  /** PointerEvent.tiltX/tiltY in degrees (-90..90); Wacom-style. */
  tiltX?: number | null;
  tiltY?: number | null;
  /** PointerEvent.altitudeAngle/azimuthAngle in radians; Apple Pencil / modern. Preferred. */
  altitudeAngle?: number | null;
  azimuthAngle?: number | null;
  /** PointerEvent.twist in degrees (0..359), barrel rotation. */
  twist?: number | null;
}

export interface BrushTiltState {
  hasTilt: boolean;
  /** 90 = upright, 0 = flat against the surface. */
  altitudeDeg: number;
  /** 0..360 direction of lean, 0 = +X, clockwise. */
  azimuthDeg: number;
  hasTwist: boolean;
  twistDeg: number;
  /** 0 (upright) .. 1 (flat) — how far the pen is tilted over. */
  tiltAmount: number;
}

const RAD2DEG = 180 / Math.PI;
/** A fully laid-down tip (side of the lead) widens up to (1 + this) times its base size. */
const MAX_TILT_SIZE_GROWTH = 3;

function isFiniteNum(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeDegrees(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Resolve raw pointer tilt/rotation into the canonical tilt state. Prefers the
 * altitude/azimuth angles (more accurate, reported by modern styli); falls back to
 * tiltX/tiltY. Returns an upright, no-tilt state when nothing usable is present.
 */
export function resolveBrushTiltState(input: PointerTiltInput): BrushTiltState {
  let altitudeDeg = 90;
  let azimuthDeg = 0;
  let hasTilt = false;

  if (isFiniteNum(input.altitudeAngle) && (isFiniteNum(input.azimuthAngle))) {
    // altitudeAngle: 0 = flat, π/2 = upright (radians).
    altitudeDeg = clamp(input.altitudeAngle * RAD2DEG, 0, 90);
    azimuthDeg = normalizeDegrees(input.azimuthAngle * RAD2DEG);
    // Treat a near-upright pen with a default azimuth as "no meaningful tilt".
    hasTilt = altitudeDeg < 89.5;
  } else if (isFiniteNum(input.tiltX) || isFiniteNum(input.tiltY)) {
    const tiltX = isFiniteNum(input.tiltX) ? input.tiltX : 0;
    const tiltY = isFiniteNum(input.tiltY) ? input.tiltY : 0;
    if (tiltX !== 0 || tiltY !== 0) {
      // Magnitude of the lean; tilt of 90° on an axis means fully flat.
      const magnitude = Math.min(90, Math.hypot(tiltX, tiltY));
      altitudeDeg = 90 - magnitude;
      // Direction the pen tip points; screen Y grows downward so atan2(tiltY, tiltX)
      // already reads clockwise.
      azimuthDeg = normalizeDegrees(Math.atan2(tiltY, tiltX) * RAD2DEG);
      hasTilt = magnitude > 0.5;
    }
  }

  const hasTwist = isFiniteNum(input.twist) && input.twist !== 0;
  const twistDeg = hasTwist ? normalizeDegrees(input.twist as number) : 0;
  const tiltAmount = clamp(1 - altitudeDeg / 90, 0, 1);

  return { hasTilt, altitudeDeg, azimuthDeg, hasTwist, twistDeg, tiltAmount };
}

export interface BrushTiltDynamicsSettings {
  /** 0..1 — how strongly tilt steers the brush angle toward the lean direction. */
  tiltAngle: number;
  /** 0..1 — how strongly tilt flattens the tip (lower roundness as the pen lays down). */
  tiltRoundness: number;
  /** 0..1 — how much the footprint grows as the pen tilts (covers more area). */
  tiltSize: number;
  /** When true, barrel twist rotates the tip directly. */
  rotationFollowsTwist: boolean;
}

export interface BrushTiltDynamicsInput {
  baseAngleDeg: number;
  baseRoundness: number;
  baseSize: number;
  tilt: BrushTiltState;
  settings: BrushTiltDynamicsSettings;
}

export interface BrushTiltDynamicsResult {
  angleDeg: number;
  roundness: number;
  size: number;
}

/**
 * Apply tilt + twist to the brush tip. Tilt flattens the tip (roundness ↓), can grow it
 * (size ↑), and steers its long axis toward the lean direction; barrel twist rotates the
 * tip. With no tilt/twist the base values pass through unchanged.
 */
export function applyBrushTiltDynamics(input: BrushTiltDynamicsInput): BrushTiltDynamicsResult {
  const { tilt, settings } = input;
  let angleDeg = input.baseAngleDeg;
  let roundness = input.baseRoundness;
  let size = input.baseSize;

  if (tilt.hasTilt) {
    const amount = tilt.tiltAmount;
    // Flatten: a fully tilted pen squashes the tip toward `1 - tiltRoundness` of its base.
    const squash = 1 - clamp(settings.tiltRoundness, 0, 1) * amount;
    roundness = clamp(roundness * squash, 0.05, 1);
    // Grow with tilt: a laid-down tip covers much more (drawing with the side of the lead,
    // not just the point). tiltSize 1 widens up to ~4x at full tilt.
    size = size * (1 + clamp(settings.tiltSize, 0, 1) * amount * MAX_TILT_SIZE_GROWTH);
    // Steer the tip's long axis toward the lean direction. Azimuth is a direction,
    // not a magnitude: changing the pen's altitude must not compress its rotation.
    // Previously this was also multiplied by `amount`, so a pen held at a typical
    // 45-degree altitude turned a physical 90-degree sweep into only 45 degrees.
    // Keep altitude responsible for footprint squash/growth while `tiltAngle` alone
    // controls how strongly the authored tip angle follows the physical azimuth.
    const steer = clamp(settings.tiltAngle, 0, 1);
    angleDeg = angleDeg + shortestAngleDelta(angleDeg, tilt.azimuthDeg) * steer;
  }

  if (settings.rotationFollowsTwist && tilt.hasTwist) {
    angleDeg = input.baseAngleDeg + tilt.twistDeg;
  }

  return { angleDeg: normalizeSignedAngle(angleDeg), roundness, size };
}

/** Smallest signed delta (deg) to rotate `from` onto `to`, in (-180, 180]. */
function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

function normalizeSignedAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export interface BrushTiltPreviewRing {
  width: number;
  height: number;
  rotationDeg: number;
}

export interface BrushTiltPreview {
  /** The tipped tip footprint (ellipse) — flattened + rotated per tilt/twist. */
  footprint: BrushTiltPreviewRing;
  /**
   * The pen-shaft indicator: a line from the contact point in the lean direction whose
   * length grows as the pen tilts flatter. Null when the pen is (near) upright.
   */
  shaft: { angleDeg: number; lengthPx: number } | null;
  /** Barrel-rotation tick angle (deg), or null when no twist is reported. */
  twistTickDeg: number | null;
}

/**
 * Krita-style 3D tip preview: the flattened/rotated footprint plus a shaft line showing
 * which way the pen leans in 3D and a barrel-twist tick. Pure geometry; the overlay just
 * draws it.
 */
export function computeBrushTiltPreview(input: {
  sizePx: number;
  baseRoundness: number;
  tilt: BrushTiltState;
  settings: BrushTiltDynamicsSettings;
}): BrushTiltPreview {
  const dyn = applyBrushTiltDynamics({
    baseAngleDeg: 0,
    baseRoundness: input.baseRoundness,
    baseSize: input.sizePx,
    tilt: input.tilt,
    settings: input.settings,
  });

  const footprint: BrushTiltPreviewRing = {
    width: dyn.size,
    height: Math.max(2, dyn.size * dyn.roundness),
    rotationDeg: dyn.angleDeg,
  };

  // The shaft points toward the pen body. azimuth (the projection of the pen onto the
  // surface, per the PointerEvent spec) already points from the tip toward the held end,
  // so the indicator must use the azimuth directly — NOT azimuth+180, which made the
  // indicator lean opposite the physical pen. It lengthens as the pen lays down.
  const shaft = input.tilt.hasTilt
    ? {
        angleDeg: normalizeDegrees(input.tilt.azimuthDeg),
        lengthPx: (input.sizePx / 2) + input.tilt.tiltAmount * input.sizePx,
      }
    : null;

  return {
    footprint,
    shaft,
    twistTickDeg: input.tilt.hasTwist ? input.tilt.twistDeg : null,
  };
}
