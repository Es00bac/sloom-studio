/**
 * Sloom Studio (GPL) — wet-surface evolution seam. Without the physical-media engine there is
 * no wet field to evolve; every call is a no-op and every query reports "nothing".
 */
import type { TiltmarkLayerSubstrateRaster } from './TiltmarkRuntime';

export interface TiltmarkWetClockSnapshot {
  mode: string;
  rate: number;
  accumulatorMs: number;
  simulationStep: number;
}

export interface TiltmarkWetGravitySettings {
  directionDeg: number;
  strength: number;
}

export interface TiltmarkWetEvolutionStatus {
  activeTiles: number;
  evolvingTiles: number;
  paused: boolean;
  rate: number;
  gravity: TiltmarkWetGravitySettings;
  wetSurfaces: number;
}

export type TiltmarkWetEvolutionEvent =
  | { readonly kind: 'presented'; readonly layerId: string; readonly raster: TiltmarkLayerSubstrateRaster }
  | {
    readonly kind: 'snapshot';
    readonly layerId: string;
    readonly simulationData: string;
    readonly simulation: { readonly byteLength: number; readonly tileCount: number; readonly stepCount: number; readonly evolvingTileCount: number };
  }
  | { readonly kind: 'settled'; readonly layerId: string };

type EvolutionListener = (event: TiltmarkWetEvolutionEvent) => void;

export function endTiltmarkWetInputActivity(): void {}
export function noteTiltmarkWetInputActivity(): void {}
export function getTiltmarkWetClockSnapshot(_documentId: string, _layerId: string): TiltmarkWetClockSnapshot | null { return null; }
export function getTiltmarkWetSimulationData(_documentId: string, _layerId: string): string | null { return null; }
export function requestTiltmarkWetSnapshot(_documentId: string, _layerId: string, _delayMs = 250): void {}
export function setTiltmarkWetActiveDocument(_documentId: string | null): void {}
export function setTiltmarkWetPendingClockAccumulator(_documentId: string, _layerId: string, _accumulatorMs: number): void {}
export function subscribeTiltmarkWetEvolution(_documentId: string, _listener: EvolutionListener): () => void { return () => {}; }
export function disposeTiltmarkWetEvolution(): void {}
