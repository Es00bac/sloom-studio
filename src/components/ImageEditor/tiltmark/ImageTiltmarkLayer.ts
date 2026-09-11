import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type {
  ImageDocument,
  ImageLayer,
  ImageTiltmarkLayerMetadata,
  ImageTiltmarkSurfaceProfile,
} from '../../../types/imageEditor';
import { createBitmap } from '../LayerBitmap';

export const IMAGE_TILTMARK_LAYER_SCHEMA_VERSION = 1 as const;
export const IMAGE_TILTMARK_SIMULATION_VERSION = 1 as const;
export const MAX_IMAGE_TILTMARK_STATE_BYTES = 48 * 1024 * 1024;
export const MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH = 70 * 1024 * 1024;
export const MAX_IMAGE_TILTMARK_TILES = 256;

const STATE_PREFIX = 'data:application/vnd.sloom.tiltmark+json;encoding=gzip;base64,';

export interface ImageTiltmarkSimulationEnvelope {
  version: typeof IMAGE_TILTMARK_SIMULATION_VERSION;
  simulation: Record<string, unknown>;
}

export type ImageTiltmarkGroupLayer = ImageLayer & {
  type: 'group';
  metadata: {
    tiltmark: ImageTiltmarkLayerMetadata & { role: 'group' };
  };
};

export type ImageTiltmarkSurfaceLayer = ImageLayer & {
  type: 'image';
  metadata: {
    tiltmark: ImageTiltmarkLayerMetadata & {
      role: 'surface';
      surface: ImageTiltmarkSurfaceProfile;
    };
  };
};

function profile(
  value: Omit<ImageTiltmarkSurfaceProfile, 'schemaVersion'>,
): Readonly<ImageTiltmarkSurfaceProfile> {
  return Object.freeze({
    schemaVersion: IMAGE_TILTMARK_LAYER_SCHEMA_VERSION,
    ...value,
    topology: Object.freeze({ ...value.topology }),
  });
}

export const IMAGE_TILTMARK_SURFACE_PROFILES: readonly Readonly<ImageTiltmarkSurfaceProfile>[] =
  Object.freeze([
    profile({
      presetId: 'smooth-synthetic',
      name: 'Smooth synthetic',
      type: 'synthetic',
      absorbency: 0.08,
      sizing: 0.94,
      roughness: 0.03,
      stainResponse: 0.12,
      liftResponse: 0.9,
      dryingMultiplier: 0.72,
      topology: {
        seed: 191, scalePx: 72, roughness: 0.03, octaves: 1,
        toothAngleRad: 0, toothAspect: 1,
      },
    }),
    profile({
      presetId: 'hot-press',
      name: 'Hot press',
      type: 'paper',
      absorbency: 0.36,
      sizing: 0.76,
      roughness: 0.16,
      stainResponse: 0.34,
      liftResponse: 0.72,
      dryingMultiplier: 0.9,
      topology: {
        seed: 421, scalePx: 18, roughness: 0.16, octaves: 2,
        toothAngleRad: 0.15, toothAspect: 1.08,
      },
    }),
    profile({
      presetId: 'cold-press',
      name: 'Cold press',
      type: 'paper',
      absorbency: 0.63,
      sizing: 0.38,
      roughness: 0.54,
      stainResponse: 0.6,
      liftResponse: 0.48,
      dryingMultiplier: 1,
      topology: {
        seed: 733, scalePx: 29, roughness: 0.54, octaves: 4,
        toothAngleRad: 0.32, toothAspect: 1.22,
      },
    }),
    profile({
      presetId: 'rough-watercolor',
      name: 'Rough watercolor',
      type: 'paper',
      absorbency: 0.84,
      sizing: 0.15,
      roughness: 0.86,
      stainResponse: 0.82,
      liftResponse: 0.3,
      dryingMultiplier: 1.32,
      topology: {
        seed: 1189, scalePx: 48, roughness: 0.86, octaves: 5,
        toothAngleRad: 0.58, toothAspect: 1.45,
      },
    }),
    profile({
      presetId: 'laid-paper',
      name: 'Laid paper',
      type: 'paper',
      absorbency: 0.48,
      sizing: 0.57,
      roughness: 0.38,
      stainResponse: 0.52,
      liftResponse: 0.56,
      dryingMultiplier: 1.05,
      topology: {
        seed: 1543, scalePx: 15, roughness: 0.38, octaves: 3,
        toothAngleRad: 0, toothAspect: 4.4,
        fibreTransportVersion: 1, fibreDirection: 'x', fibreAnisotropy: 0.82,
      },
    }),
    profile({
      presetId: 'canvas',
      name: 'Canvas',
      type: 'canvas',
      absorbency: 0.34,
      sizing: 0.64,
      roughness: 0.64,
      stainResponse: 0.28,
      liftResponse: 0.7,
      dryingMultiplier: 0.82,
      topology: {
        seed: 2029, scalePx: 34, roughness: 0.64, octaves: 4,
        toothAngleRad: Math.PI / 2, toothAspect: 2.25,
        fibreTransportVersion: 1, fibreDirection: 'y', fibreAnisotropy: 0.32,
      },
    }),
  ]);

export function imageTiltmarkSurfaceProfileById(
  id: string | null | undefined,
): ImageTiltmarkSurfaceProfile {
  const found = IMAGE_TILTMARK_SURFACE_PROFILES.find((candidate) => candidate.presetId === id)
    ?? IMAGE_TILTMARK_SURFACE_PROFILES[2]!;
  return structuredClone(found);
}

export function isImageTiltmarkGroup(
  layer: ImageLayer | null | undefined,
): layer is ImageTiltmarkGroupLayer {
  return layer?.type === 'group' && layer.metadata?.tiltmark?.role === 'group';
}

export function isImageTiltmarkSurface(
  layer: ImageLayer | null | undefined,
): layer is ImageTiltmarkSurfaceLayer {
  return layer?.type === 'image' && layer.metadata?.tiltmark?.role === 'surface';
}

export function imageDocumentHasEditableTiltmarkSurface(
  doc: Pick<ImageDocument, 'layers'> | null | undefined,
): boolean {
  return Boolean(doc?.layers.some(isImageTiltmarkSurface));
}

export function imageDocumentHasPhysicalTiltmarkSurface(
  doc: Pick<ImageDocument, 'layers'> | null | undefined,
): boolean {
  return Boolean(doc?.layers.some((layer) => (
    isImageTiltmarkSurface(layer)
    && (layer.metadata.tiltmark.materialState === 'physical' || Boolean(layer.tiltmarkSimulationData))
  )));
}

export function createImageTiltmarkLayerSet(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  profileId = 'cold-press',
): { group: ImageLayer; surface: ImageLayer } {
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  const groupId = `layer-tiltmark-group-${nonce}`;
  const surfaceId = `layer-tiltmark-surface-${nonce}`;
  const surface = imageTiltmarkSurfaceProfileById(profileId);
  const groupMetadata: ImageTiltmarkLayerMetadata = {
    schemaVersion: IMAGE_TILTMARK_LAYER_SCHEMA_VERSION,
    role: 'group',
  };
  const surfaceMetadata: ImageTiltmarkLayerMetadata = {
    schemaVersion: IMAGE_TILTMARK_LAYER_SCHEMA_VERSION,
    role: 'surface',
    surface,
    materialState: 'empty',
    strokeCount: 0,
  };
  return {
    group: {
      id: groupId,
      name: 'Tiltmark',
      type: 'group',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 0,
      mask: null,
      groupExpanded: true,
      metadata: { tiltmark: groupMetadata },
    },
    surface: {
      id: surfaceId,
      name: `Tiltmark Base — ${surface.name}`,
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: createBitmap(doc.width, doc.height),
      bitmapVersion: 0,
      mask: null,
      groupId,
      metadata: { tiltmark: surfaceMetadata },
      tiltmarkBaseBitmap: createBitmap(doc.width, doc.height),
      tiltmarkSimulationData: null,
    },
  };
}

export function convertImageTiltmarkLayerToRaster(layer: ImageLayer): ImageLayer {
  if (!isImageTiltmarkSurface(layer)) return layer;
  const { tiltmarkBaseBitmap: _base, tiltmarkBaseBitmapData: _baseData,
    tiltmarkSimulationData: _simulationData, ...rest } = layer;
  const { tiltmark: _tiltmark, ...metadata } = rest.metadata;
  return {
    ...rest,
    name: layer.name.replace(/^Tiltmark Base(?:\s+—\s+.+)?$/, 'Raster Layer'),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    // Keep explicit clears in the returned patch: Layers commits through the
    // store's merge-style updateLayer action, where omission would preserve
    // the old retained smart payload.
    tiltmarkBaseBitmap: undefined,
    tiltmarkBaseBitmapData: undefined,
    tiltmarkSimulationData: undefined,
    bitmapVersion: layer.bitmapVersion + 1,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function validSimulationEnvelope(
  value: unknown,
  width: number,
  height: number,
): value is ImageTiltmarkSimulationEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.version !== IMAGE_TILTMARK_SIMULATION_VERSION) return false;
  if (!envelope.simulation || typeof envelope.simulation !== 'object') return false;
  const simulation = envelope.simulation as Record<string, unknown>;
  const config = simulation.config;
  if (!config || typeof config !== 'object') return false;
  const resolvedConfig = config as Record<string, unknown>;
  const tiles = simulation.tiles;
  if (!(Number(resolvedConfig.widthPx) === width
    && Number(resolvedConfig.heightPx) === height
    && Number.isFinite(Number(resolvedConfig.cellSizePx))
    && Number(resolvedConfig.cellSizePx) >= 1
    && Number(resolvedConfig.cellSizePx) <= 256
    && Number.isInteger(Number(resolvedConfig.tileSizeCells))
    && Number(resolvedConfig.tileSizeCells) >= 4
    && Number(resolvedConfig.tileSizeCells) <= 64
    && Number.isInteger(Number(resolvedConfig.maxActiveTiles))
    && Number(resolvedConfig.maxActiveTiles) >= 1
    && Number(resolvedConfig.maxActiveTiles) <= 4096
    && Number.isFinite(Number(resolvedConfig.paperAbsorbency))
    && Number(resolvedConfig.paperAbsorbency) >= 0
    && Number(resolvedConfig.paperAbsorbency) <= 1
    && Number.isFinite(Number(resolvedConfig.paperSizing))
    && Number(resolvedConfig.paperSizing) >= 0
    && Number(resolvedConfig.paperSizing) <= 1
    && [2, 3, 4].includes(Number(simulation.version))
    && Number.isSafeInteger(Number(simulation.stepCount))
    && Number(simulation.stepCount) >= 0
    && Number.isSafeInteger(Number(simulation.touchSerial))
    && Number(simulation.touchSerial) >= 0
    && Array.isArray(tiles)
    && tiles.length <= MAX_IMAGE_TILTMARK_TILES)) return false;

  const cellSize = Number(resolvedConfig.cellSizePx);
  const tileSize = Number(resolvedConfig.tileSizeCells);
  const cellsPerTile = tileSize * tileSize;
  const tileColumns = Math.ceil(width / cellSize / tileSize);
  const tileRows = Math.ceil(height / cellSize / tileSize);
  const knownKeys = new Set<string>();
  for (const tileValue of tiles) {
    if (!tileValue || typeof tileValue !== 'object' || Array.isArray(tileValue)) return false;
    const tile = tileValue as Record<string, unknown>;
    if (typeof tile.key !== 'string' || knownKeys.has(tile.key)) return false;
    const match = /^(\d+),(\d+)$/.exec(tile.key);
    const lastTouched = tile.lastTouched ?? tile.last_touched;
    if (!match
      || Number(match[1]) >= tileColumns
      || Number(match[2]) >= tileRows
      || !Number.isSafeInteger(Number(lastTouched))
      || Number(lastTouched) < 0
      || !tile.channels
      || typeof tile.channels !== 'object'
      || Array.isArray(tile.channels)) return false;
    const channels = tile.channels as Record<string, unknown>;
    for (const required of ['water', 'suspendedMass', 'depositedMass', 'reactivation', 'cure']) {
      if (!Object.hasOwn(channels, required)) return false;
    }
    const channelEntries = Object.entries(channels);
    if (channelEntries.length > 40) return false;
    for (const [, samples] of channelEntries) {
      if (!Array.isArray(samples)
        || samples.length !== cellsPerTile
        || !samples.every((sample) => (
          typeof sample === 'number'
          && Number.isFinite(sample)
          && sample >= -1e9
          && sample <= 1e9
        ))) return false;
    }
    knownKeys.add(tile.key);
  }
  const validQueue = (value: unknown): boolean => (
    Array.isArray(value)
    && value.length <= MAX_IMAGE_TILTMARK_TILES
    && value.every((key) => typeof key === 'string' && knownKeys.has(key))
  );
  return validQueue(simulation.activeKeys)
    && validQueue(simulation.deferredKeys ?? [])
    && validQueue(simulation.dormantKeys ?? []);
}

export function encodeImageTiltmarkSimulation(
  simulation: Record<string, unknown>,
): string | null {
  const json = strToU8(JSON.stringify({
    version: IMAGE_TILTMARK_SIMULATION_VERSION,
    simulation,
  } satisfies ImageTiltmarkSimulationEnvelope));
  if (json.byteLength > MAX_IMAGE_TILTMARK_STATE_BYTES) return null;
  return `${STATE_PREFIX}${bytesToBase64(gzipSync(json, { level: 6 }))}`;
}

export function decodeImageTiltmarkSimulation(
  value: unknown,
  width: number,
  height: number,
): ImageTiltmarkSimulationEnvelope | null {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH
    || !value.startsWith(STATE_PREFIX)) return null;
  try {
    const compressed = base64ToBytes(value.slice(STATE_PREFIX.length));
    if (compressed.byteLength < 18) return null;
    const footer = compressed.byteLength - 4;
    const advertisedSize = (
      compressed[footer]!
      | compressed[footer + 1]! << 8
      | compressed[footer + 2]! << 16
      | compressed[footer + 3]! << 24
    ) >>> 0;
    if (advertisedSize > MAX_IMAGE_TILTMARK_STATE_BYTES) return null;
    const bytes = gunzipSync(compressed);
    if (bytes.byteLength > MAX_IMAGE_TILTMARK_STATE_BYTES) return null;
    const decoded: unknown = JSON.parse(strFromU8(bytes));
    return validSimulationEnvelope(decoded, width, height) ? decoded : null;
  } catch {
    return null;
  }
}

export function imageTiltmarkStateByteLength(value: string | null | undefined): number {
  if (!value?.startsWith(STATE_PREFIX)) return 0;
  return Math.floor(value.slice(STATE_PREFIX.length).length * 0.75);
}

function unit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function boundedInteger(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(0, Math.min(maximum, value))
    : fallback;
}

/** Sanitize the small JSON metadata contract; the large solver payload is validated separately. */
export function sanitizeImageTiltmarkLayerMetadata(
  value: unknown,
): ImageTiltmarkLayerMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== IMAGE_TILTMARK_LAYER_SCHEMA_VERSION
    || (source.role !== 'group' && source.role !== 'surface')) return undefined;
  if (source.role === 'group') {
    return { schemaVersion: IMAGE_TILTMARK_LAYER_SCHEMA_VERSION, role: 'group' };
  }
  const surfaceSource = source.surface && typeof source.surface === 'object'
    ? source.surface as Record<string, unknown>
    : {};
  const fallback = imageTiltmarkSurfaceProfileById(
    typeof surfaceSource.presetId === 'string' ? surfaceSource.presetId : undefined,
  );
  const simulationSource = source.simulation && typeof source.simulation === 'object'
    ? source.simulation as Record<string, unknown>
    : null;
  return {
    schemaVersion: IMAGE_TILTMARK_LAYER_SCHEMA_VERSION,
    role: 'surface',
    surface: {
      ...fallback,
      absorbency: unit(surfaceSource.absorbency, fallback.absorbency),
      sizing: unit(surfaceSource.sizing, fallback.sizing),
      roughness: unit(surfaceSource.roughness, fallback.roughness),
      stainResponse: unit(surfaceSource.stainResponse, fallback.stainResponse),
      liftResponse: unit(surfaceSource.liftResponse, fallback.liftResponse),
      dryingMultiplier: typeof surfaceSource.dryingMultiplier === 'number'
        && Number.isFinite(surfaceSource.dryingMultiplier)
        ? Math.max(0.25, Math.min(4, surfaceSource.dryingMultiplier))
        : fallback.dryingMultiplier,
      topology: {
        ...fallback.topology,
        roughness: unit(surfaceSource.roughness, fallback.roughness),
      },
    },
    materialState: source.materialState === 'physical' ? 'physical' : 'empty',
    strokeCount: boundedInteger(source.strokeCount, 0, 1_000_000),
    ...(typeof source.lastPresetId === 'string' && source.lastPresetId.length <= 128
      ? { lastPresetId: source.lastPresetId }
      : {}),
    ...(simulationSource?.format === 'tiltmark-substrate'
      && simulationSource.version === IMAGE_TILTMARK_SIMULATION_VERSION
      ? {
          simulation: {
            format: 'tiltmark-substrate',
            version: IMAGE_TILTMARK_SIMULATION_VERSION,
            byteLength: boundedInteger(
              simulationSource.byteLength,
              0,
              MAX_IMAGE_TILTMARK_STATE_BYTES,
            ),
            tileCount: boundedInteger(simulationSource.tileCount, 0, MAX_IMAGE_TILTMARK_TILES),
            stepCount: boundedInteger(simulationSource.stepCount, 0),
            evolvingTileCount: boundedInteger(
              simulationSource.evolvingTileCount,
              0,
              MAX_IMAGE_TILTMARK_TILES,
            ),
            updatedAt: boundedInteger(simulationSource.updatedAt, 0),
          },
        }
      : {}),
  };
}
