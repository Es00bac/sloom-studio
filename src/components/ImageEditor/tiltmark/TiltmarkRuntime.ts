/**
 * Sloom Studio (GPL) — physical-media engine seam.
 *
 * The proprietary Tiltmark engine is not included in this repository. This module keeps the
 * runtime seam so that documents which reference physical-media layers still load, and so a
 * separately licensed engine could be attached behind this interface later. Every entry point
 * here either reports "engine absent" or performs no work; nothing simulates paint.
 */
import type { BrushSettings, ImageLayer, ImageTiltmarkLayerMetadata } from '../../../types/imageEditor';
import type {
  TiltmarkBrushDab,
  TiltmarkBrushPreset,
  TiltmarkStrokeAppendResult,
  TiltmarkWasmModule,
} from './TiltmarkTypes';

export const TILTMARK_ENGINE_ABSENT_MESSAGE =
  'The physical-media brush engine is not included in this build of Sloom Studio.';

export interface TiltmarkHistoryState {
  readonly [key: string]: unknown;
}

export interface TiltmarkStrokeSession {
  readonly preset: TiltmarkBrushPreset;
  readonly historyBefore: TiltmarkHistoryState | null;
  begin(point: { x: number; y: number }, event: PointerEvent): TiltmarkStrokeAppendResult;
  append(point: { x: number; y: number }, event: PointerEvent): TiltmarkStrokeAppendResult;
  advanceTo(timeMs: number): TiltmarkStrokeAppendResult;
  end(point: { x: number; y: number }, event: PointerEvent): TiltmarkStrokeAppendResult;
  historyAfter(): TiltmarkHistoryState | null;
  cancel(): void;
  dispose(): void;
}

export type TiltmarkLayerSubstrateRaster = {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
};

export interface TiltmarkLayerSubstrateResult {
  handled: boolean;
  simulationData: string | null;
  metadata: ImageTiltmarkLayerMetadata;
  raster: TiltmarkLayerSubstrateRaster | null;
}

export type TiltmarkModuleLoader = () => Promise<TiltmarkWasmModule>;

function engineAbsent(): never {
  throw new Error(TILTMARK_ENGINE_ABSENT_MESSAGE);
}

export function setTiltmarkSimulationControls(
  _settings: Pick<BrushSettings, 'tiltmarkWetPhysics' | 'tiltmarkEvaporationRate'>,
): void {}

export async function initializeTiltmarkRuntime(_input: { licensed: boolean }): Promise<TiltmarkWasmModule> {
  return null;
}

export function isTiltmarkRuntimeReady(): boolean {
  return false;
}

export function lockTiltmarkRuntime(): void {}

export function resetTiltmarkRuntime(): void {}

export function releaseTiltmarkLayerSubstrate(_documentId: string, _layerId: string): void {}

export function releaseTiltmarkDocumentSubstrates(_documentId: string): void {}

export function restoreTiltmarkHistoryState(_stateInput: unknown): void {}

export function setTiltmarkModuleLoaderForTests(_loader: TiltmarkModuleLoader): void {}

export function restoreTiltmarkModuleLoaderAfterTests(): void {}

export function createTiltmarkStrokeSession(_input: unknown): TiltmarkStrokeSession {
  return engineAbsent();
}

export function applyTiltmarkLayerSubstrateDabs(_input: {
  documentId: string;
  layer: ImageLayer;
  width: number;
  height: number;
  dabs: readonly TiltmarkBrushDab[];
  preset: TiltmarkBrushPreset;
  [key: string]: unknown;
}): TiltmarkLayerSubstrateResult {
  return engineAbsent();
}

export function checkpointTiltmarkLayerSubstrate(_input: {
  documentId: string;
  layer: ImageLayer;
  width: number;
  height: number;
}): Pick<TiltmarkLayerSubstrateResult, 'simulationData' | 'metadata' | 'raster'> | null {
  return null;
}

export function renderTiltmarkLayerSubstrate(_input: {
  documentId: string;
  layer: ImageLayer;
  width: number;
  height: number;
}): TiltmarkLayerSubstrateRaster | null {
  return null;
}
