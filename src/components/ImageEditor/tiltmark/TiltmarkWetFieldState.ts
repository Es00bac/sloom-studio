/**
 * Sloom Software LLC — Confidential and Proprietary
 *
 * Hane-compatible .slimg wet-field state codec.
 *
 * Hane versions its physical layers inside .slimg v2 (`document.physical`,
 * extension version 1) with per-layer wet-field references that carry either
 * the legacy v1 marker or the v2 `presentationAuthority` contract, and stores
 * the field itself as raw JSON: `{ version, presentationAuthority?, simulation,
 * clock }`. Sloom writes and reads exactly that shape so Hane artwork opens
 * with live wet media in Sloom Studio Image and Sloom files open in Hane.
 */

import {
  encodeImageTiltmarkSimulation,
  type ImageTiltmarkSimulationEnvelope,
} from './ImageTiltmarkLayer';

export const TILTMARK_WET_FIELD_VERSION = 2 as const;
export const TILTMARK_WET_FIELD_LEGACY_VERSION = 1 as const;
export const TILTMARK_WET_FIELD_PRESENTATION_AUTHORITY =
  'base-bitmap-plus-substrate' as const;
export const MAX_TILTMARK_WET_FIELD_BYTES = 48 * 1024 * 1024;
export const MAX_TILTMARK_WET_FIELD_TILES = 65_536;

/** Mirrors Hane's SimulationClockSnapshot contract. */
export interface TiltmarkWetClockSnapshot {
  readonly mode: string;
  readonly rate: number;
  readonly accumulatorMs: number;
  readonly simulationStep: number;
}

export interface TiltmarkWetFieldStateV1 {
  version: typeof TILTMARK_WET_FIELD_LEGACY_VERSION;
  simulation: Record<string, unknown>;
  clock: TiltmarkWetClockSnapshot;
}

export interface TiltmarkWetFieldStateV2 {
  version: typeof TILTMARK_WET_FIELD_VERSION;
  presentationAuthority: typeof TILTMARK_WET_FIELD_PRESENTATION_AUTHORITY;
  simulation: Record<string, unknown>;
  clock: TiltmarkWetClockSnapshot;
}

export type TiltmarkWetFieldState = TiltmarkWetFieldStateV1 | TiltmarkWetFieldStateV2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clockSnapshot(value: unknown): TiltmarkWetClockSnapshot | null {
  if (!isRecord(value)) return null;
  const accumulatorMs = Number(value.accumulatorMs);
  const rate = Number(value.rate);
  const simulationStep = Number(value.simulationStep);
  if (
    !Number.isFinite(accumulatorMs)
    || accumulatorMs < 0
    || !Number.isFinite(rate)
    || rate <= 0
    || !Number.isSafeInteger(simulationStep)
    || simulationStep < 0
  ) return null;
  return {
    mode: typeof value.mode === 'string' ? value.mode : 'idle',
    rate,
    accumulatorMs,
    simulationStep,
  };
}

function simulationSnapshot(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  // Hane accepts Rust substrate snapshots v2..v10; the pinned engine is the
  // restore authority and rejects anything it cannot replay.
  const version = value.version;
  if (
    version !== 2 && version !== 3 && version !== 4 && version !== 5
    && version !== 6 && version !== 7 && version !== 8 && version !== 9
    && version !== 10
  ) return null;
  if (!isRecord(value.config) || !Array.isArray(value.tiles)) return null;
  if (value.tiles.length < 1 || value.tiles.length > MAX_TILTMARK_WET_FIELD_TILES) {
    return null;
  }
  return value;
}

/**
 * Parses a Hane wet-field state asset exactly like Hane's
 * `parseHaneWetFieldState`: byte-bounded, version-discriminated, with the v2
 * presentation contract enforced. Returns null for anything else.
 */
export function parseTiltmarkWetFieldState(
  bytes: Uint8Array,
): TiltmarkWetFieldState | null {
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_TILTMARK_WET_FIELD_BYTES) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (
    value.version !== TILTMARK_WET_FIELD_LEGACY_VERSION
    && value.version !== TILTMARK_WET_FIELD_VERSION
  ) return null;
  if (
    value.version === TILTMARK_WET_FIELD_VERSION
    && value.presentationAuthority !== TILTMARK_WET_FIELD_PRESENTATION_AUTHORITY
  ) return null;
  const simulation = simulationSnapshot(value.simulation);
  const clock = clockSnapshot(value.clock);
  if (!simulation || !clock) return null;
  if (value.version === TILTMARK_WET_FIELD_VERSION) {
    return {
      version: TILTMARK_WET_FIELD_VERSION,
      presentationAuthority: TILTMARK_WET_FIELD_PRESENTATION_AUTHORITY,
      simulation,
      clock,
    };
  }
  return {
    version: TILTMARK_WET_FIELD_LEGACY_VERSION,
    simulation,
    clock,
  };
}

/** Serializes a v2 wet-field state asset in Hane's exact JSON shape. */
export function encodeTiltmarkWetFieldState(input: {
  simulation: Record<string, unknown>;
  clock: TiltmarkWetClockSnapshot;
}): Uint8Array {
  const json = JSON.stringify({
    version: TILTMARK_WET_FIELD_VERSION,
    presentationAuthority: TILTMARK_WET_FIELD_PRESENTATION_AUTHORITY,
    simulation: input.simulation,
    clock: input.clock,
  });
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > MAX_TILTMARK_WET_FIELD_BYTES) {
    throw new Error('Tiltmark wet-field state exceeds the persisted byte envelope.');
  }
  return bytes;
}

/**
 * Hane persists settled fields too: reactivatable paint, relief, wax, and
 * loose dry media remain editable after the solver goes idle. This is the
 * same bounded channel inspection Hane performs before writing a field.
 */
export function shouldPersistTiltmarkWetField(
  simulation: Record<string, unknown>,
): boolean {
  const tiles = simulation.tiles;
  if (!Array.isArray(tiles)) return false;
  const epsilon = 1e-7;
  const reactivationEpsilon = 1e-6;
  return tiles.some((tile) => {
    if (!isRecord(tile) || !isRecord(tile.channels)) return false;
    const channels = tile.channels as Record<string, unknown>;
    const channelValues = (name: string): readonly number[] => {
      const values = channels[name];
      return Array.isArray(values) ? values as readonly number[] : [];
    };
    const bodyVolume = channelValues('bodyVolume');
    if (bodyVolume.some((value) => Number(value) > 1e-12)) return true;
    for (const dryChannel of [
      'coloredPencilMass',
      'dryGraphiteMass',
      'dryCharcoalMass',
      'dryPastelMass',
    ]) {
      if (channelValues(dryChannel).some((value) => Number(value) > epsilon)) return true;
    }
    const suspendedMass = channelValues('suspendedMass');
    const depositedMass = channelValues('depositedMass');
    const acrylic = channelValues('acrylic');
    const oil = channelValues('oil');
    const cure = channelValues('cure');
    return channelValues('reactivation').some((response, index) => (
      Number(response)
        * (Number(acrylic[index]) + Number(oil[index]) > epsilon
          ? Math.max(0, 1 - Number(cure[index]))
          : 1) > reactivationEpsilon
      && Number(suspendedMass[index]) + Number(depositedMass[index]) > epsilon
    ));
  });
}

/** Unwraps a Sloom runtime envelope into its raw Rust simulation snapshot. */
export function simulationFromSloomEnvelope(
  envelope: ImageTiltmarkSimulationEnvelope | null,
): Record<string, unknown> | null {
  return envelope?.simulation && isRecord(envelope.simulation)
    ? envelope.simulation
    : null;
}

/** Wraps a raw Rust simulation snapshot into Sloom's runtime envelope. */
export function sloomEnvelopeFromSimulation(
  simulation: Record<string, unknown>,
): string | null {
  return encodeImageTiltmarkSimulation(simulation);
}

export function wetFieldTileCount(simulation: Record<string, unknown>): number {
  const tiles = simulation.tiles;
  return Array.isArray(tiles) ? tiles.length : 0;
}
