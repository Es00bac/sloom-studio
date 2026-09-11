import { strFromU8 } from 'fflate';
import {
  SLIMG_V2_LIMITS,
  createSlimgV2AssetRecord,
  exportSlimgV1CompatibilityCopy,
  readSlimgManifest,
  sha256Hex,
  validateSlimgV2Manifest,
  verifySlimgV2Assets,
  type JsonObject,
  type JsonValue,
  type SlimgV1CompatibilityReport,
  type SlimgV2AdjustmentKind,
  type SlimgV2AlphaMaskRef,
  type SlimgV2AssetRecord,
  type SlimgV2BitmapAssetRef,
  type SlimgV2Guide,
  type SlimgV2Layer,
  type SlimgV2LayerTransform,
  type SlimgV2Manifest,
  type SlimgV2PhysicalState,
  type SlimgV2SmartFilter,
} from '../../lib/slimgV2';
import { unzipBoundedZipSync, type BoundedZipLimits } from '../../lib/boundedZip';
import { packContainer, type ContainerManifest } from '../../shared/files/SignalLoomContainer';
import type {
  BlendMode,
  ImageAdjustmentSettings,
  ImageDocument,
  ImageLayer,
  ImageLayerFilter,
  ImageLayerFilterMask,
  ImageVectorShape,
  LayerBitmap,
  SelectionMaskSnapshot,
  TextLayerStyle,
  SmartSource,
} from '../../types/imageEditor';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { normalizeImageFrameAnimationDocument } from './ImageFrameAnimation';
import {
  createBitmap,
  getBitmapImageData,
  putBitmapImageData,
} from './LayerBitmap';
import {
  deserializeSlimg as deserializeLegacySlimg,
  serializeSlimg as serializeLegacySlimg,
  type SlimgCodec,
} from './ImageSlimgFormat';
import {
  getImageSlimgRuntimeState,
  setImageSlimgRuntimeState,
  type ImageSlimgRuntimeState,
} from './ImageSlimgRuntimeState';
import { getSelection } from './selectionRegistry';
import {
  applyHighBitLayerRestore,
  buildHighBitSection,
  HIGH_BIT_DIVERGENCE_REOPEN_WARNING,
  highBitSectionDiverged,
  restoreHighBitRuntimePixels,
  stripHighBitRuntimePixels,
} from './pixels/ImageHighBitPersistence';
import { normalizeWorkingDepth } from './pixels/ImageHighBitDocument';
import {
  decodeImageTiltmarkSimulation,
  sanitizeImageTiltmarkLayerMetadata,
} from './tiltmark/ImageTiltmarkLayer';
import {
  getTiltmarkWetClockSnapshot,
  getTiltmarkWetSimulationData,
  setTiltmarkWetPendingClockAccumulator,
} from './tiltmark/TiltmarkWetEvolution';
import {
  encodeTiltmarkWetFieldState,
  parseTiltmarkWetFieldState,
  shouldPersistTiltmarkWetField,
  simulationFromSloomEnvelope,
  sloomEnvelopeFromSimulation,
  TILTMARK_WET_FIELD_PRESENTATION_AUTHORITY,
  wetFieldTileCount,
} from './tiltmark/TiltmarkWetFieldState';
import { readSmartObjectFilterStack } from './smartObjects/SmartFilters';
import {
  cloneImageCmykPixelBuffer,
  imageCmykDocumentUsesNativeAuthority,
} from './cmyk/ImageCmykDocument';

const SLIMG_ARCHIVE_LIMITS: BoundedZipLimits = {
  archiveLabel: '.slimg',
  maxEntries: SLIMG_V2_LIMITS.maxAssets + 1,
  maxEntryUncompressedBytes: SLIMG_V2_LIMITS.maxAssetBytes,
  maxTotalUncompressedBytes:
    SLIMG_V2_LIMITS.maxTotalAssetBytes + SLIMG_V2_LIMITS.maxManifestBytes,
  maxCompressionRatio: 2_048,
};

interface SlimgArchive {
  manifest: unknown;
  manifestByteLength: number;
  assets: Map<string, Uint8Array>;
}

interface SlimgV2Parts {
  manifest: SlimgV2Manifest;
  assets: Map<string, Uint8Array>;
}

export interface SerializedSlimgV1Compatibility {
  bytes: Uint8Array;
  report: SlimgV1CompatibilityReport;
}

function parseArchive(bytes: Uint8Array): SlimgArchive {
  const entries = unzipBoundedZipSync(bytes, SLIMG_ARCHIVE_LIMITS);
  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new Error('.slimg: missing manifest.json.');
  let manifest: unknown;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as unknown;
  } catch {
    throw new Error('.slimg: invalid manifest JSON.');
  }
  const assets = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (path === 'manifest.json') continue;
    if (!path.startsWith('assets/') || path.length <= 'assets/'.length) {
      throw new Error(`.slimg: unexpected archive member ${path}.`);
    }
    assets.set(path.slice('assets/'.length), data);
  }
  return {
    manifest,
    manifestByteLength: manifestBytes.byteLength,
    assets,
  };
}

function safeBlendMode(value: BlendMode): SlimgV2Layer['blendMode'] {
  switch (value) {
    case 'normal':
    case 'multiply':
    case 'screen':
    case 'overlay':
    case 'darken':
    case 'lighten':
    case 'color-dodge':
    case 'color-burn':
    case 'hard-light':
    case 'soft-light':
    case 'difference':
    case 'exclusion':
      return value;
    default:
      return 'normal';
  }
}

function layerWidth(layer: ImageLayer, documentWidth: number): number {
  return Math.max(
    1,
    Math.min(
      documentWidth,
      layer.bitmap?.width
        ?? layer.text?.boxWidth
        ?? layer.metadata?.vectorShape?.width
        ?? documentWidth,
    ),
  );
}

function layerHeight(layer: ImageLayer, documentHeight: number): number {
  return Math.max(
    1,
    Math.min(
      documentHeight,
      layer.bitmap?.height
        ?? layer.text?.boxHeight
        ?? layer.metadata?.vectorShape?.height
        ?? documentHeight,
    ),
  );
}

function layerTransform(
  layer: ImageLayer,
  documentWidth: number,
  documentHeight: number,
  original?: SlimgV2LayerTransform,
): SlimgV2LayerTransform {
  const rotation = (layer.rotationDeg ?? 0) * Math.PI / 180;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  let linear: [number, number, number, number] = [
    cosine,
    sine,
    -sine,
    cosine,
  ];
  if (original) {
    const [a, b, c, d] = original.affine;
    const originalRotation = Math.atan2(b, a);
    const delta = rotation - originalRotation;
    const deltaCosine = Math.cos(delta);
    const deltaSine = Math.sin(delta);
    linear = [
      deltaCosine * a - deltaSine * b,
      deltaSine * a + deltaCosine * b,
      deltaCosine * c - deltaSine * d,
      deltaSine * c + deltaCosine * d,
    ];
  }
  const transform: SlimgV2LayerTransform = {
    affine: [...linear, layer.x ?? 0, layer.y ?? 0],
  };
  if (layer.skewXDeg || layer.skewYDeg || original?.skew) {
    transform.skew = {
      xRad: (layer.skewXDeg ?? 0) * Math.PI / 180,
      yRad: (layer.skewYDeg ?? 0) * Math.PI / 180,
    };
  }
  if (layer.perspectiveX || layer.perspectiveY || original?.perspective) {
    type PerspectiveMatrix =
      NonNullable<SlimgV2LayerTransform['perspective']>['matrix'];
    const matrix = original?.perspective
      ? [...original.perspective.matrix] as PerspectiveMatrix
      : [
          1, 0, 0,
          0, 1, 0,
          0, 0, 1,
        ] as PerspectiveMatrix;
    matrix[6] = layer.perspectiveX ?? 0;
    matrix[7] = layer.perspectiveY ?? 0;
    transform.perspective = {
      matrix,
    };
  }
  if (layer.cornerOffsets) {
    transform.cornerDistort = {
      topLeft: { x: layer.cornerOffsets.nw.x, y: layer.cornerOffsets.nw.y },
      topRight: { x: layer.cornerOffsets.ne.x, y: layer.cornerOffsets.ne.y },
      bottomRight: { x: layer.cornerOffsets.se.x, y: layer.cornerOffsets.se.y },
      bottomLeft: { x: layer.cornerOffsets.sw.x, y: layer.cornerOffsets.sw.y },
    };
  }
  if (layer.warpMesh) {
    const columns = layer.warpMesh.columns + 1;
    const rows = layer.warpMesh.rows + 1;
    if (
      columns >= 2
      && columns <= SLIMG_V2_LIMITS.maxWarpColumns
      && rows >= 2
      && rows <= SLIMG_V2_LIMITS.maxWarpRows
      && layer.warpMesh.points.length === columns * rows
    ) {
      const width = layerWidth(layer, documentWidth);
      const height = layerHeight(layer, documentHeight);
      transform.warpMesh = {
        columns,
        rows,
        points: layer.warpMesh.points.map((point, index) => {
          const column = index % columns;
          const row = Math.floor(index / columns);
          return {
            x: layer.x + (column / (columns - 1) + point.x) * width,
            y: layer.y + (row / (rows - 1) + point.y) * height,
          };
        }),
      };
    }
  }
  return transform;
}

function adjustmentKind(value: ImageAdjustmentSettings['kind']): SlimgV2AdjustmentKind {
  switch (value) {
    case 'brightnessContrast': return 'brightness-contrast';
    case 'hueSaturation': return 'hsl';
    case 'blackWhite': return 'black-and-white';
    case 'temperatureTint': return 'temperature-tint';
    case 'gradientMap': return 'gradient-map';
    case 'channelMixer': return 'channel-mixer';
    case 'selectiveColor': return 'selective-color';
    default: return value;
  }
}

function textWeight(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return Math.max(1, Math.min(1000, parsed));
  return value === 'bold' ? 700 : 400;
}

function textLayerRecord(text: TextLayerStyle): Extract<SlimgV2Layer, { kind: 'text' }>['text'] {
  return {
    content: text.content.slice(0, SLIMG_V2_LIMITS.maxTextLength),
    direction: text.orientation ?? 'horizontal',
    fontFamily: text.fontFamily.slice(0, 240) || 'sans-serif',
    fontWeight: textWeight(text.fontWeight),
    fontStyle: text.fontStyle,
    fontSizePx: Math.max(0.1, text.fontSize),
    kerning: text.fontKerning !== 'none',
    letterSpacingPx: text.letterSpacing,
    baselineShiftPx: text.baselineShift,
    lineHeight: Math.max(0.01, text.lineHeight),
    alignment: text.align === 'left'
      ? 'start'
      : text.align === 'right'
        ? 'end'
        : text.align,
    ...(text.wrap && text.boxWidth && text.boxWidth > 0
      ? { wrapWidthPx: text.boxWidth }
      : {}),
    ...(text.warp !== 'none' ? { warp: text.warp } : {}),
    fill: /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(text.color)
      ? text.color
      : '#000000',
  };
}

function jsonRecipe(layer: ImageLayer): { format: string; recipe: JsonValue } {
  if (layer.metadata?.vectorShape) {
    const vectorShape = layer.metadata.vectorShape;
    if (vectorShape.kind === 'path') {
      const { preset, ...withoutPreset } = vectorShape;
      return {
        format: 'sloom-vector-shape-v1',
        recipe: structuredClone(preset === undefined ? withoutPreset : vectorShape) as unknown as JsonValue,
      };
    }
    return {
      format: 'sloom-vector-shape-v1',
      recipe: structuredClone(vectorShape) as unknown as JsonValue,
    };
  }
  const source = layer.vectorRecipe ?? layer.metadata?.originalSvgSource ?? '';
  return {
    format: 'sloom-svg-v1',
    recipe: { source },
  };
}

function decodedVectorRecipe(
  vector: Extract<SlimgV2Layer, { kind: 'vector' }>['vector'],
): string {
  return vector.format === 'sloom-svg-v1'
    && typeof (vector.recipe as JsonObject).source === 'string'
    ? String((vector.recipe as JsonObject).source)
    : JSON.stringify(vector.recipe);
}

function decodeRetainedVectorShape(
  vector: Extract<SlimgV2Layer, { kind: 'vector' }>['vector'],
): ImageVectorShape | null {
  if (vector.format !== 'sloom-vector-shape-v1' || !isJsonObject(vector.recipe)) return null;
  const recipe = vector.recipe;
  const kind = recipe.kind;
  if ((kind !== 'rect' && kind !== 'ellipse' && kind !== 'path')
    || !isFinitePositive(recipe.width)
    || !isFinitePositive(recipe.height)
    || typeof recipe.fillColor !== 'string'
    || !isFiniteUnit(recipe.fillOpacity)
    || typeof recipe.strokeColor !== 'string'
    || !isFiniteUnit(recipe.strokeOpacity)
    || !isFiniteNonNegative(recipe.strokeWidth)) return null;
  if (kind === 'rect' || kind === 'ellipse') return structuredClone(recipe) as unknown as ImageVectorShape;
  if (!Array.isArray(recipe.points) || typeof recipe.closed !== 'boolean'
    || !recipe.points.every((point) => isJsonObject(point) && Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const live = recipe.liveBoolean;
  if (live !== undefined && (!isJsonObject(live)
    || live.version !== 1
    || !['union', 'intersect', 'subtract', 'xor'].includes(String(live.operation))
    || !Array.isArray(live.sourceLayerIds)
    || live.sourceLayerIds.length !== 2
    || !live.sourceLayerIds.every((id) => typeof id === 'string' && id.length > 0)
    || live.sourceLayerIds[0] === live.sourceLayerIds[1]
    || !Number.isInteger(live.outputIndex)
    || Number(live.outputIndex) < 0)) return null;
  return structuredClone(recipe) as unknown as ImageVectorShape;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFiniteUnit(value: unknown): value is number {
  return isFiniteNonNegative(value) && value <= 1;
}

function extractAlpha(bitmap: LayerBitmap): Uint8Array {
  const rgba = getBitmapImageData(bitmap).data;
  const alpha = new Uint8Array(bitmap.width * bitmap.height);
  for (let source = 3, target = 0; target < alpha.length; source += 4, target += 1) {
    alpha[target] = rgba[source] ?? 0;
  }
  return alpha;
}

function alphaBitmap(bytes: Uint8Array, width: number, height: number): LayerBitmap {
  if (bytes.byteLength !== width * height) {
    throw new Error('.slimg alpha8 asset length does not match its dimensions.');
  }
  const bitmap = createBitmap(width, height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let source = 0, target = 0; source < bytes.length; source += 1, target += 4) {
    rgba[target] = 255;
    rgba[target + 1] = 255;
    rgba[target + 2] = 255;
    rgba[target + 3] = bytes[source]!;
  }
  putBitmapImageData(bitmap, {
    width,
    height,
    data: rgba,
  } as ImageData);
  return bitmap;
}

async function decodeAlphaAsset(
  record: SlimgV2AssetRecord,
  bytes: Uint8Array,
  ref: SlimgV2AlphaMaskRef,
  codec: SlimgCodec,
): Promise<{ bitmap: LayerBitmap; alpha: Uint8ClampedArray }> {
  if (record.mimeType.startsWith('image/')) {
    const bitmap = await codec.decode(bytes, ref.width, ref.height);
    return {
      bitmap,
      alpha: new Uint8ClampedArray(extractAlpha(bitmap)),
    };
  }
  const bitmap = alphaBitmap(bytes, ref.width, ref.height);
  return { bitmap, alpha: new Uint8ClampedArray(bytes) };
}

function preservedAssetIds(state: ImageSlimgRuntimeState | undefined): Set<string> {
  const result = new Set<string>();
  if (!state) return result;
  const { document, assets } = state.manifest;
  if (document.color.workingProfileAssetId) result.add(document.color.workingProfileAssetId);
  if (document.color.proof) result.add(document.color.proof.profileAssetId);
  if (document.timelapse) {
    result.add(document.timelapse.initialKeyframeAssetId);
    document.timelapse.chunks.forEach((chunk) => result.add(chunk.assetId));
  }
  if (document.physical) {
    if (document.physical.documentStateAssetId) result.add(document.physical.documentStateAssetId);
    document.physical.layers.forEach((layer) => {
      result.add(layer.stateAssetId);
      if (layer.baseBitmap) result.add(layer.baseBitmap.assetId);
    });
  }
  if (document.migrationBackupAssetId) result.add(document.migrationBackupAssetId);
  for (const layer of document.layers) {
    if (layer.kind === 'text' && layer.text.fontAssetId) result.add(layer.text.fontAssetId);
  }
  for (const record of assets) {
    if (
      record.role === 'other'
      && record.id !== document.sloomStudio?.nativeDocumentAssetId
    ) result.add(record.id);
  }
  return result;
}

async function buildSlimgV2Parts(
  document: ImageDocument,
  codec: SlimgCodec,
): Promise<SlimgV2Parts> {
  const runtime = getImageSlimgRuntimeState(document.id);
  const original = runtime?.manifest.document;
  const originalLayerById = new Map(
    (original?.layers ?? []).map((layer) => [layer.id, layer]),
  );
  // Save-time authority: wet layers serialize their live substrate state so a
  // save is exact even when the last stroke's coalesced persistence snapshot
  // has not fired yet. Layers without a live surface keep their stored value.
  const liveSimulationData = new Map<string, string>();
  for (const layer of document.layers) {
    if (!layer.tiltmarkSimulationData) continue;
    const live = getTiltmarkWetSimulationData(document.id, layer.id);
    if (live) liveSimulationData.set(layer.id, live);
  }
  if (liveSimulationData.size > 0) {
    document = {
      ...document,
      layers: document.layers.map((layer) => (
        liveSimulationData.has(layer.id)
          ? { ...layer, tiltmarkSimulationData: liveSimulationData.get(layer.id) }
          : layer
      )),
    };
  }
  const assets = new Map<string, Uint8Array>();
  const records = new Map<string, SlimgV2AssetRecord>();
  const preserved = preservedAssetIds(runtime);
  if (runtime) {
    for (const record of runtime.manifest.assets) {
      if (!preserved.has(record.id)) continue;
      const bytes = runtime.assets.get(record.id);
      if (!bytes) {
        throw new Error(`.slimg cannot preserve missing opaque asset ${record.id}.`);
      }
      assets.set(record.id, bytes);
      records.set(record.id, record);
    }
  }

  const addAsset = async (
    bytes: Uint8Array,
    metadata: Pick<SlimgV2AssetRecord, 'mimeType' | 'role' | 'fileName'>,
    extension: string,
  ): Promise<SlimgV2AssetRecord> => {
    const digest = sha256Hex(bytes);
    const id = `${metadata.role}-${digest}.${extension}`;
    const current = records.get(id);
    if (current) {
      if (current.sha256 !== digest || current.role !== metadata.role) {
        throw new Error(`.slimg content-address collision for ${id}.`);
      }
      return current;
    }
    const record = await createSlimgV2AssetRecord(id, bytes, metadata);
    records.set(id, record);
    assets.set(id, new Uint8Array(bytes));
    return record;
  };

  const bitmapRef = async (
    bitmap: LayerBitmap | null | undefined,
    role: 'pixels' | 'raster-fallback',
  ): Promise<SlimgV2BitmapAssetRef | null> => {
    if (!bitmap) return null;
    const bytes = await codec.encode(bitmap);
    const record = await addAsset(bytes, { mimeType: 'image/png', role }, 'png');
    return { assetId: record.id, width: bitmap.width, height: bitmap.height };
  };

  const maskRef = async (
    bitmap: LayerBitmap | null | undefined,
  ): Promise<SlimgV2AlphaMaskRef | undefined> => {
    if (!bitmap) return undefined;
    const bytes = extractAlpha(bitmap);
    const record = await addAsset(
      bytes,
      { mimeType: 'application/octet-stream', role: 'mask' },
      'alpha',
    );
    return {
      assetId: record.id,
      width: bitmap.width,
      height: bitmap.height,
      encoding: 'alpha8',
    };
  };

  const smartFilterMaskRef = async (
    mask: ImageLayerFilterMask | undefined,
  ): Promise<SlimgV2AlphaMaskRef | undefined> => {
    if (!mask) return undefined;
    const bytes = new Uint8Array(mask.alpha);
    const record = await addAsset(
      bytes,
      { mimeType: 'application/octet-stream', role: 'mask' },
      'alpha',
    );
    return {
      assetId: record.id,
      width: mask.width,
      height: mask.height,
      encoding: 'alpha8',
    };
  };

  const legacyBytes = await serializeLegacySlimg(
    stripHighBitRuntimePixels(document),
    codec,
  );
  const nativeRecord = await addAsset(
    legacyBytes,
    {
      mimeType: 'application/x-sloom-slimg',
      role: 'other',
      fileName: `${document.title || 'image'}-sloom-native-v1.slimg`,
    },
    'slimg',
  );

  const smartSources = await Promise.all(Object.values(document.metadata?.smartSources ?? {}).map(async (source) => {
    if (source.kind === 'embedded') {
      const bytes = source.embeddedBytes ?? runtime?.assets.get(source.bytesAssetId ?? '');
      if (!bytes) throw new Error(`.slimg cannot save Smart Object source ${source.id} without embedded bytes.`);
      const record = await addAsset(bytes, { mimeType: source.mimeType, role: 'smart-source', fileName: source.label }, 'bin');
      if (record.sha256 !== source.sha256 || record.byteLength !== source.byteLength) throw new Error(`.slimg Smart Object source ${source.id} failed its integrity proof.`);
      return { id: source.id, kind: source.kind, mimeType: source.mimeType, byteLength: source.byteLength, sha256: source.sha256, nativeWidth: source.nativeWidth, nativeHeight: source.nativeHeight, label: source.label, version: source.version, bytesAssetId: record.id } as const;
    }
    return { id: source.id, kind: source.kind, mimeType: source.mimeType, byteLength: source.byteLength, sha256: source.sha256, nativeWidth: source.nativeWidth, nativeHeight: source.nativeHeight, label: source.label, version: source.version, ...(source.linked ? { linkedSourceLibraryItemId: source.linked.sourceLibraryItemId } : {}) } as const;
  }));

  /**
   * C2 makes one stack a source-owned contract. Older local-only instance stacks are never
   * guessed at save time: a divergent or malformed source fails before writing a partial archive.
   */
  const smartFilterStacks = new Map<string, ImageLayerFilter[]>();
  for (const layer of document.layers) {
    const sourceId = layer.smartObject?.sourceId;
    if (!sourceId || smartFilterStacks.has(sourceId)) continue;
    const stack = readSmartObjectFilterStack(document.layers, sourceId, layer.id);
    if (!stack.ok) throw new Error(`.slimg cannot save Smart Filter stack for ${sourceId}: ${stack.blocker.message}`);
    if (stack.value.divergentInstanceIds.length > 0) {
      throw new Error(`.slimg cannot save divergent Smart Filter stacks for source ${sourceId}; synchronize its instances first.`);
    }
    smartFilterStacks.set(sourceId, stack.value.filters);
  }

  const physicalLayers: SlimgV2PhysicalState['layers'] = [];
  const layers: SlimgV2Layer[] = [];
  for (const [index, layer] of document.layers.entries()) {
    const originalLayer = originalLayerById.get(layer.id);
    const mask = await maskRef(layer.mask);
    const common = {
      id: layer.id,
      name: (layer.name || `Layer ${index + 1}`).slice(0, SLIMG_V2_LIMITS.maxLayerNameLength),
      visible: layer.visible,
      locked: layer.locked,
      alphaLocked: Boolean(layer.locks?.pixels),
      opacity: Math.max(0, Math.min(1, layer.opacity)),
      blendMode: safeBlendMode(layer.blendMode),
      clippingMask: Boolean(layer.clippingMask),
      ...(layer.groupId ? { parentId: layer.groupId } : {}),
      transform: layerTransform(
        layer,
        document.width,
        document.height,
        originalLayer?.transform,
      ),
      ...(mask ? {
        mask: {
          bitmap: mask,
          enabled: true,
          density: Math.max(0, Math.min(1, layer.maskDensity ?? 1)),
          featherPx: Math.max(0, layer.maskFeather ?? 0),
        },
      } : {}),
      ...(layer.maskLinkSourceLayerId ? { maskLinkSourceLayerId: layer.maskLinkSourceLayerId } : {}),
      ...(layer.smartObject
        ? {
            smartObject: structuredClone(layer.smartObject),
            smartFilters: await Promise.all((smartFilterStacks.get(layer.smartObject.sourceId) ?? []).map(async (filter): Promise<SlimgV2SmartFilter> => ({
              id: filter.id,
              kind: filter.kind,
              enabled: filter.enabled,
              amount: filter.amount,
              opacity: filter.opacity,
              blendMode: filter.blendMode,
              ...(filter.mask ? { mask: await smartFilterMaskRef(filter.mask) } : {}),
            }))),
          }
        : {}),
      ...(layer.metadata?.tiltmark?.surface
        ? {
            substrateProfile:
              structuredClone(layer.metadata.tiltmark.surface) as unknown as JsonObject,
          }
        : {}),
    };
    if (layer.type === 'group') {
      layers.push({
        ...common,
        kind: 'group',
        expanded: layer.groupExpanded !== false,
        ...(layer.groupPassThrough === true ? { passThrough: true } : {}),
      });
      continue;
    }
    if (layer.type === 'text' || layer.text) {
      const fallbackBitmap = layer.bitmap
        ?? renderImageDocumentLayersToBitmap({ ...document, layers: [layer] });
      const fallback = await bitmapRef(fallbackBitmap, 'raster-fallback');
      if (!fallback || !layer.text) {
        throw new Error(`.slimg cannot save editable text layer ${layer.name} without its text and raster fallback.`);
      }
      layers.push({
        ...common,
        kind: 'text',
        text: {
          ...textLayerRecord(layer.text),
          ...(originalLayer?.kind === 'text'
            && originalLayer.text.fontAssetId
            && originalLayer.text.fontFamily === layer.text.fontFamily
            ? { fontAssetId: originalLayer.text.fontAssetId }
            : {}),
          ...(originalLayer?.kind === 'text' && originalLayer.text.stroke
            ? { stroke: structuredClone(originalLayer.text.stroke) }
            : {}),
        },
        rasterFallback: fallback,
      });
    } else if (layer.type === 'adjustment' || layer.adjustment) {
      const fallbackBitmap = layer.bitmap
        ?? renderImageDocumentLayersToBitmap({
          ...document,
          layers: document.layers.slice(0, index + 1),
        });
      const fallback = await bitmapRef(fallbackBitmap, 'raster-fallback');
      if (!fallback || !layer.adjustment) {
        throw new Error(`.slimg cannot save adjustment layer ${layer.name} without its settings and raster fallback.`);
      }
      layers.push({
        ...common,
        kind: 'adjustment',
        adjustment: originalLayer?.kind === 'adjustment'
          && JSON.stringify(decodeAdjustment(
            originalLayer.adjustment.kind,
            originalLayer.adjustment.parameters,
          )) === JSON.stringify(layer.adjustment)
          ? structuredClone(originalLayer.adjustment)
          : (() => {
              const parameters = serializeAdjustmentParameters(layer.adjustment);
              delete parameters.kind;
              return {
                kind: adjustmentKind(layer.adjustment.kind),
                parameters,
                clippingAware: originalLayer?.kind === 'adjustment'
                  ? originalLayer.adjustment.clippingAware
                  : true,
              };
            })(),
        rasterFallback: fallback,
      });
    } else if (
      layer.type === 'vector'
      || layer.vectorRecipe
      || layer.metadata?.vectorShape
      || layer.metadata?.originalSvgSource
    ) {
      const fallbackBitmap = layer.bitmap
        ?? renderImageDocumentLayersToBitmap({ ...document, layers: [layer] });
      const fallback = await bitmapRef(fallbackBitmap, 'raster-fallback');
      if (!fallback) {
        throw new Error(`.slimg cannot save editable vector layer ${layer.name} without a raster fallback.`);
      }
      layers.push({
        ...common,
        kind: 'vector',
        vector: originalLayer?.kind === 'vector'
          && decodedVectorRecipe(originalLayer.vector) === layer.vectorRecipe
          ? structuredClone(originalLayer.vector)
          : jsonRecipe(layer),
        rasterFallback: fallback,
      });
    } else {
      layers.push({
        ...common,
        kind: 'raster',
        pixels: await bitmapRef(layer.bitmap, 'pixels'),
      });
    }

    if (layer.tiltmarkSimulationData) {
      // Hane-compatible wet-field persistence: the state asset is Hane's
      // versioned JSON envelope (simulation + clock), referenced with the v2
      // presentation contract. Settled fields without reactivatable material
      // are not persisted, matching Hane's shouldPersistHaneWetField.
      const envelope = decodeImageTiltmarkSimulation(
        layer.tiltmarkSimulationData,
        document.width,
        document.height,
      );
      const simulation = simulationFromSloomEnvelope(envelope);
      if (simulation && shouldPersistTiltmarkWetField(simulation)) {
        const clock = getTiltmarkWetClockSnapshot(document.id, layer.id) ?? {
          mode: 'idle',
          rate: 1,
          accumulatorMs: 0,
          simulationStep: layer.metadata?.tiltmark?.simulation?.stepCount ?? 0,
        };
        try {
          const stateBytes = encodeTiltmarkWetFieldState({ simulation, clock });
          const state = await addAsset(
            stateBytes,
            { mimeType: 'application/json', role: 'tiltmark-state' },
            'json',
          );
          const base = await bitmapRef(layer.tiltmarkBaseBitmap, 'pixels');
          physicalLayers.push({
            layerId: layer.id,
            stateAssetId: state.id,
            byteLength: state.byteLength,
            tileCount: wetFieldTileCount(simulation),
            ...(base ? { baseBitmap: base } : {}),
            presentationAuthority: TILTMARK_WET_FIELD_PRESENTATION_AUTHORITY,
          });
        } catch {
          // A wet field that cannot fit its persisted envelope stays in the
          // embedded native archive only; the layer opens as baked pixels
          // elsewhere, which the missing presentation contract communicates.
        }
      }
    }
  }

  const liveSelection = document.hasSelection
    ? getSelection(document.id) ?? document.selectionMask
    : undefined;
  let selection: SlimgV2Manifest['document']['selection'];
  if (
    liveSelection
    && liveSelection.width === document.width
    && liveSelection.height === document.height
    && liveSelection.data.byteLength === document.width * document.height
    && liveSelection.data.some((value) => value !== 0)
  ) {
    const record = await addAsset(
      new Uint8Array(liveSelection.data),
      { mimeType: 'application/octet-stream', role: 'selection-mask' },
      'alpha',
    );
    selection = {
      mask: {
        assetId: record.id,
        width: document.width,
        height: document.height,
        encoding: 'alpha8',
      },
      ...(document.activeLayerId ? { sourceLayerId: document.activeLayerId } : {}),
    };
  }

  const currentGuideIds = new Set((document.guides ?? []).map((guide) => guide.id));
  const preservedGuides = (original?.guides ?? []).filter((guide) => !currentGuideIds.has(guide.id));
  const guides: SlimgV2Guide[] = [
    ...preservedGuides,
    ...(document.guides ?? []).map((guide): SlimgV2Guide => ({
      id: guide.id,
      kind: 'ruler',
      enabled: true,
      assisted: true,
      opacity: 0.6,
      points: guide.axis === 'x'
        ? [{ x: guide.position, y: 0 }, { x: guide.position, y: document.height }]
        : [{ x: 0, y: guide.position }, { x: document.width, y: guide.position }],
    })),
  ];

  const existingPhysical = original?.physical;
  const regeneratedPhysicalLayerIds = new Set(physicalLayers.map((layer) => layer.layerId));
  const liveLayerIds = new Set(document.layers.map((layer) => layer.id));
  const mergedPhysicalLayers = [
    ...(existingPhysical?.layers ?? []).filter(
      (layer) => liveLayerIds.has(layer.layerId)
        && !regeneratedPhysicalLayerIds.has(layer.layerId),
    ),
    ...physicalLayers,
  ];
  const activeLayerId = document.layers.some((layer) => layer.id === document.activeLayerId)
    ? document.activeLayerId!
    : document.layers.find((layer) => layer.type !== 'group')?.id
      ?? document.layers[0]?.id;
  if (!activeLayerId || layers.length === 0) {
    throw new Error('.slimg v2 requires at least one layer and an active layer.');
  }

  const highBit = await buildHighBitSection(document, addAsset);

  const manifest: SlimgV2Manifest = {
    format: 'signal-loom-image',
    formatVersion: 2,
    kind: 'image',
    generator: {
      name: 'Sloom Studio Image',
      version: 2,
      brushEngine: document.layers.some((layer) => layer.metadata?.tiltmark)
        ? 'Studio + Tiltmark'
        : 'Studio',
    },
    document: {
      id: document.id,
      title: document.title.slice(0, 1024) || 'Untitled image',
      width: document.width,
      height: document.height,
      dpi: original?.dpi ?? 300,
      background: original?.background ?? 'transparent',
      activeLayerId,
      layers,
      ...(selection ? { selection } : {}),
      guides,
      color: original?.color ?? {
        workingSpace: document.metadata?.colorProof?.mode === 'rgb'
          ? 'srgb'
          : 'srgb',
      },
      ...(original?.timelapse ? { timelapse: original.timelapse } : {}),
      ...(existingPhysical || mergedPhysicalLayers.length > 0
        ? {
            physical: {
              version: Math.max(existingPhysical?.version ?? 1, 1),
              ...(existingPhysical?.paperProfile
                ? { paperProfile: existingPhysical.paperProfile }
                : {}),
              ...(existingPhysical?.documentStateAssetId
                ? { documentStateAssetId: existingPhysical.documentStateAssetId }
                : {}),
              layers: mergedPhysicalLayers,
            },
          }
        : {}),
      ...(original?.migrationBackupAssetId
        ? { migrationBackupAssetId: original.migrationBackupAssetId }
        : runtime?.migrationBackup
          ? { migrationBackupAssetId: runtime.migrationBackup.record.id }
          : {}),
      sourceApplication: 'Sloom Studio Image',
      sloomStudio: {
        schemaVersion: 1,
        nativeDocumentAssetId: nativeRecord.id,
      },
      ...(smartSources.length > 0 ? { smartSources } : {}),
      ...(highBit ? { highBit, requiredFeatures: ['high-bit-pixels'] } : {}),
    },
    assets: [...records.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
  validateSlimgV2Manifest(manifest);
  await verifySlimgV2Assets(manifest, assets);
  return { manifest, assets };
}

function decodeAdjustment(
  kind: SlimgV2AdjustmentKind,
  parameters: JsonObject,
): ImageAdjustmentSettings {
  const source = structuredClone(parameters) as Record<string, unknown>;
  const restoredKind = kind === 'brightness-contrast'
    ? 'brightnessContrast'
    : kind === 'hsl'
      ? 'hueSaturation'
      : kind === 'black-and-white'
        ? 'blackWhite'
        : kind === 'temperature-tint'
          ? 'temperatureTint'
        : kind === 'gradient-map'
          ? 'gradientMap'
          : kind === 'channel-mixer'
            ? 'channelMixer'
            : kind === 'selective-color'
              ? 'selectiveColor'
          : kind;
  if (restoredKind === 'lut' && source.lutDataValues && typeof source.lutDataValues === 'object') {
    const values = Array.isArray(source.lutDataValues)
      ? source.lutDataValues
      : Object.keys(source.lutDataValues as Record<string, unknown>)
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => (source.lutDataValues as Record<string, unknown>)[key]);
    if (values.length === 256 && values.every((value) => typeof value === 'number')) {
      source.lutDataValues = values as number[];
      source.lutData = Uint8ClampedArray.from(values as number[]);
    }
  }
  return {
    ...source,
    kind: restoredKind,
  } as ImageAdjustmentSettings;
}

function serializeAdjustmentParameters(settings: ImageAdjustmentSettings): Record<string, JsonValue> {
  const parameters = structuredClone(settings) as unknown as Record<string, JsonValue>;
  if (settings.kind === 'lut') {
    const values = settings.lutData ? Array.from(settings.lutData) : settings.lutDataValues;
    if (values) parameters.lutDataValues = values;
    delete parameters.lutData;
  }
  return parameters;
}

function decodeText(
  value: Extract<SlimgV2Layer, { kind: 'text' }>['text'],
): TextLayerStyle {
  return {
    content: value.content,
    fontFamily: value.fontFamily,
    fontSize: value.fontSizePx,
    fontWeight: String(value.fontWeight),
    fontStyle: value.fontStyle,
    fontKerning: value.kerning ? 'normal' : 'none',
    fontVariantCaps: 'normal',
    letterSpacing: value.letterSpacingPx,
    baselineShift: value.baselineShiftPx,
    boxWidth: value.wrapWidthPx ?? null,
    boxHeight: null,
    wrap: value.wrapWidthPx !== undefined,
    color: value.fill,
    lineHeight: value.lineHeight,
    align: value.alignment === 'start'
      ? 'left'
      : value.alignment === 'end'
        ? 'right'
        : value.alignment,
    verticalAlign: 'top',
    orientation: value.direction,
    warp: value.warp ?? 'none',
  };
}

function decodeTransform(
  value: SlimgV2LayerTransform,
  layerWidth: number,
  layerHeight: number,
): Pick<
  ImageLayer,
  | 'x'
  | 'y'
  | 'rotationDeg'
  | 'skewXDeg'
  | 'skewYDeg'
  | 'perspectiveX'
  | 'perspectiveY'
  | 'cornerOffsets'
  | 'warpMesh'
> {
  const [a, b, , , x, y] = value.affine;
  return {
    x,
    y,
    rotationDeg: Math.atan2(b, a) * 180 / Math.PI,
    ...(value.skew
      ? {
          skewXDeg: value.skew.xRad * 180 / Math.PI,
          skewYDeg: value.skew.yRad * 180 / Math.PI,
        }
      : {}),
    ...(value.perspective
      ? {
          perspectiveX: value.perspective.matrix[6],
          perspectiveY: value.perspective.matrix[7],
        }
      : {}),
    ...(value.cornerDistort
      ? {
          cornerOffsets: {
            nw: value.cornerDistort.topLeft,
            ne: value.cornerDistort.topRight,
            se: value.cornerDistort.bottomRight,
            sw: value.cornerDistort.bottomLeft,
          },
        }
      : {}),
    ...(value.warpMesh
      ? {
          warpMesh: {
            columns: value.warpMesh.columns - 1,
            rows: value.warpMesh.rows - 1,
            points: value.warpMesh.points.map((point, index) => {
              const column = index % value.warpMesh!.columns;
              const row = Math.floor(index / value.warpMesh!.columns);
              const baseX = x + column / (value.warpMesh!.columns - 1) * layerWidth;
              const baseY = y + row / (value.warpMesh!.rows - 1) * layerHeight;
              return {
                x: (point.x - baseX) / layerWidth,
                y: (point.y - baseY) / layerHeight,
              };
            }),
          },
        }
      : {}),
  };
}

async function decodeGenericV2(
  manifest: SlimgV2Manifest,
  assets: ReadonlyMap<string, Uint8Array>,
  codec: SlimgCodec,
): Promise<ImageDocument> {
  const records = new Map(manifest.assets.map((record) => [record.id, record]));
  const physicalByLayer = new Map(
    (manifest.document.physical?.layers ?? [])
      .map((entry) => [entry.layerId, entry] as const),
  );
  // ---- MH-009 (Lane A A1) ----
  const highBitByLayer = new Map(
    (manifest.document.highBit?.layers ?? [])
      .map((entry) => [entry.layerId, entry] as const),
  );
  const highBitWorkingDepth = manifest.document.highBit
    ? normalizeWorkingDepth(manifest.document.highBit.bitDepth) === 16 ? 'u16' as const : 'f32' as const
    : 'u8' as const;
  // ---- end MH-009 (Lane A A1) ----
  const layers: ImageLayer[] = [];
  for (const source of manifest.document.layers) {
    const primaryRef = source.kind === 'raster' ? source.pixels : source.rasterFallback;
    const primaryBytes = primaryRef ? assets.get(primaryRef.assetId) : undefined;
    const bitmap = primaryRef && primaryBytes
      ? await codec.decode(primaryBytes, primaryRef.width, primaryRef.height)
      : null;
    let mask: LayerBitmap | null = null;
    if (source.mask) {
      const record = records.get(source.mask.bitmap.assetId);
      const bytes = assets.get(source.mask.bitmap.assetId);
      if (!record || !bytes) throw new Error(`.slimg missing mask ${source.mask.bitmap.assetId}.`);
      mask = (await decodeAlphaAsset(record, bytes, source.mask.bitmap, codec)).bitmap;
    }
    const transformWidth = primaryRef?.width ?? manifest.document.width;
    const transformHeight = primaryRef?.height ?? manifest.document.height;
    const base: ImageLayer = {
      id: source.id,
      name: source.name,
      type: source.kind === 'raster' ? 'image' : source.kind,
      visible: source.visible,
      locked: source.locked,
      locks: {
        pixels: source.alphaLocked,
        position: source.locked,
      },
      opacity: source.opacity,
      blendMode: source.blendMode,
      ...decodeTransform(source.transform, transformWidth, transformHeight),
      bitmap,
      bitmapVersion: bitmap ? 1 : 0,
      mask,
      ...(source.maskLinkSourceLayerId ? { maskLinkSourceLayerId: source.maskLinkSourceLayerId } : {}),
      maskDensity: source.mask?.density,
      maskFeather: source.mask?.featherPx,
      clippingMask: source.clippingMask,
      groupId: source.parentId,
      groupExpanded: source.kind === 'group' ? source.expanded : undefined,
      groupPassThrough: source.kind === 'group' && source.passThrough === true ? true : undefined,
      ...(source.smartObject ? { smartObject: structuredClone(source.smartObject) } : {}),
    };
    // ---- MH-009 (Lane A A1) ----
    const highBit = highBitByLayer.get(source.id);
    if (highBit) {
      applyHighBitLayerRestore(base, highBit, { records, assets, depth: highBitWorkingDepth });
    }
    // ---- end MH-009 (Lane A A1) ----
    if (source.smartFilters) {
      base.filters = await Promise.all(source.smartFilters.map(async (filter): Promise<ImageLayerFilter> => {
        let mask: ImageLayerFilterMask | undefined;
        if (filter.mask) {
          const record = records.get(filter.mask.assetId);
          const bytes = assets.get(filter.mask.assetId);
          if (!record || !bytes) throw new Error(`.slimg missing Smart Filter mask ${filter.mask.assetId}.`);
          const decoded = await decodeAlphaAsset(record, bytes, filter.mask, codec);
          mask = {
            width: filter.mask.width,
            height: filter.mask.height,
            alpha: [...decoded.alpha],
          };
          decoded.bitmap.width = 0;
          decoded.bitmap.height = 0;
        }
        return {
          id: filter.id,
          kind: filter.kind,
          enabled: filter.enabled,
          amount: filter.amount,
          opacity: filter.opacity,
          blendMode: filter.blendMode,
          ...(mask ? { mask } : {}),
        };
      }));
    }
    if (source.kind === 'vector') {
      base.vectorRecipe = decodedVectorRecipe(source.vector);
      const retainedShape = decodeRetainedVectorShape(source.vector);
      if (retainedShape) base.metadata = { ...base.metadata, vectorShape: retainedShape };
    } else if (source.kind === 'text') {
      base.text = decodeText(source.text);
      base.metadata = { ...base.metadata, editableText: true };
    } else if (source.kind === 'adjustment') {
      base.adjustment = decodeAdjustment(source.adjustment.kind, source.adjustment.parameters);
    }
    // Hane wet-field restore: physical layers carry a versioned JSON state
    // asset (simulation + clock). Restoring it keeps the artwork live wet
    // media instead of baked pixels; the Rust restore remains the validator.
    const physical = physicalByLayer.get(source.id);
    if (physical && base.type === 'image') {
      const stateBytes = assets.get(physical.stateAssetId);
      const wetState = stateBytes ? parseTiltmarkWetFieldState(stateBytes) : null;
      if (wetState) {
        const simulationData = sloomEnvelopeFromSimulation(wetState.simulation);
        if (simulationData) {
          base.tiltmarkSimulationData = simulationData;
          if (physical.baseBitmap) {
            const baseBytes = assets.get(physical.baseBitmap.assetId);
            base.tiltmarkBaseBitmap = baseBytes
              ? await codec.decode(
                baseBytes,
                physical.baseBitmap.width,
                physical.baseBitmap.height,
              )
              : null;
          }
          const surfaceMetadata = sanitizeImageTiltmarkLayerMetadata({
            schemaVersion: 1,
            role: 'surface',
            surface: source.substrateProfile ?? {},
            materialState: 'physical',
          });
          if (surfaceMetadata) {
            base.metadata = { ...base.metadata, tiltmark: surfaceMetadata };
          }
          setTiltmarkWetPendingClockAccumulator(
            manifest.document.id,
            source.id,
            wetState.clock.accumulatorMs,
          );
        }
      }
    }
    layers.push(base);
  }

  let selectionMask: SelectionMaskSnapshot | undefined;
  if (manifest.document.selection) {
    const ref = manifest.document.selection.mask;
    const record = records.get(ref.assetId);
    const bytes = assets.get(ref.assetId);
    if (!record || !bytes) throw new Error(`.slimg missing selection ${ref.assetId}.`);
    const decoded = await decodeAlphaAsset(record, bytes, ref, codec);
    selectionMask = {
      width: ref.width,
      height: ref.height,
      data: decoded.alpha,
    };
    decoded.bitmap.width = 0;
    decoded.bitmap.height = 0;
  }
  const guides = manifest.document.guides.flatMap((guide) => {
    if (guide.kind !== 'ruler' || guide.points.length < 2) return [];
    const [first, second] = guide.points;
    if (!first || !second) return [];
    const axis = Math.abs(first.x - second.x) <= Math.abs(first.y - second.y)
      ? 'x'
      : 'y';
    return [{
      id: guide.id,
      axis,
      position: axis === 'x' ? first.x : first.y,
    } as const];
  });
  const smartSources: Record<string, SmartSource> = {};
  for (const source of manifest.document.smartSources ?? []) {
    const bytes = source.bytesAssetId ? assets.get(source.bytesAssetId) : undefined;
    if (source.kind === 'embedded' && (!bytes || bytes.byteLength !== source.byteLength)) throw new Error(`.slimg missing Smart Object source ${source.id}.`);
    smartSources[source.id] = { id: source.id, kind: source.kind, mimeType: source.mimeType, byteLength: source.byteLength, sha256: source.sha256, nativeWidth: source.nativeWidth, nativeHeight: source.nativeHeight, label: source.label, version: source.version, ...(source.bytesAssetId ? { bytesAssetId: source.bytesAssetId, embeddedBytes: new Uint8Array(bytes!) } : {}), ...(source.linkedSourceLibraryItemId ? { linked: { sourceLibraryItemId: source.linkedSourceLibraryItemId } } : {}) };
  }
  return {
    id: manifest.document.id,
    title: manifest.document.title,
    width: manifest.document.width,
    height: manifest.document.height,
    layers,
    activeLayerId: manifest.document.activeLayerId,
    hasSelection: Boolean(selectionMask?.data.some((value) => value !== 0)),
    selectionVersion: selectionMask ? 1 : 0,
    ...(selectionMask ? { selectionMask } : {}),
    viewport: { zoom: 1, panX: 0, panY: 0 },
    guides,
    dirty: false,
    metadata: {
      sourceFormat: 'slimg',
      // ---- MH-009 (Lane A A1) ----
      ...(manifest.document.highBit
        ? {
            bitDepth: manifest.document.highBit.bitDepth,
            warnings: highBitSectionDiverged({ highBit: manifest.document.highBit })
              ? [HIGH_BIT_DIVERGENCE_REOPEN_WARNING]
              : [],
          }
        : {}),
      // ---- end MH-009 (Lane A A1) ----
      ...(manifest.document.color.proof
        ? {
            colorProof: {
              mode: 'cmyk-soft-proof',
              intent: manifest.document.color.proof.intent,
            },
          }
        : {}),
      ...(Object.keys(smartSources).length > 0 ? { smartSources } : {}),
    },
  };
}

function runtimeAssets(
  archiveAssets: ReadonlyMap<string, Uint8Array>,
  result: Awaited<ReturnType<typeof readSlimgManifest>>,
): Map<string, Uint8Array> {
  const assets = new Map(
    [...archiveAssets].map(([id, bytes]) => [id, new Uint8Array(bytes)]),
  );
  if (result.migrationBackup) {
    assets.set(
      result.migrationBackup.record.id,
      new Uint8Array(result.migrationBackup.bytes),
    );
  }
  return assets;
}

export async function deserializeSlimgAnyVersion(
  bytes: Uint8Array,
  codec: SlimgCodec,
): Promise<ImageDocument> {
  const archive = parseArchive(bytes);
  const read = await readSlimgManifest(archive.manifest, archive.assets, {
    manifestByteLength: archive.manifestByteLength,
    ...(isV1Manifest(archive.manifest)
      ? { originalV1ArchiveBytes: bytes }
      : {}),
  });
  const allAssets = runtimeAssets(archive.assets, read);
  let document: ImageDocument;
  if (read.sourceVersion === 1) {
    document = await deserializeLegacySlimg(bytes, codec);
  } else {
    const nativeAssetId = read.manifest.document.sloomStudio?.nativeDocumentAssetId;
    const nativeBytes = nativeAssetId ? allAssets.get(nativeAssetId) : undefined;
     // ---- MH-009 (Lane A A1) ----
     // A high-bit section is authoritative over the embedded 8-bit native
     // archive; the generic decoder restores the retained pixel authorities.
    if (nativeBytes && !(read.manifest.document.smartSources?.length) && !read.manifest.document.highBit) {
      const nativeArchive = parseArchive(nativeBytes);
      if (!isV1Manifest(nativeArchive.manifest)) {
        throw new Error('.slimg Sloom native document is not a v1 compatibility archive.');
      }
      document = await deserializeLegacySlimg(nativeBytes, codec);
    } else {
      document = await decodeGenericV2(read.manifest, allAssets, codec);
      if (nativeBytes) {
        const nativeArchive = parseArchive(nativeBytes);
        if (!isV1Manifest(nativeArchive.manifest)) {
          throw new Error('.slimg Sloom native document is not a v1 compatibility archive.');
        }
        const nativeDocument = await deserializeLegacySlimg(nativeBytes, codec);
        if (imageCmykDocumentUsesNativeAuthority(nativeDocument)) {
          if (read.manifest.document.highBit) {
            throw new Error('.slimg refuses a native CMYK archive combined with high-bit authority; no lossy authority precedence was guessed.');
          }
          document = mergeNativeCmykAuthority(document, nativeDocument);
        }
      }
    }
    document = restoreHighBitRuntimePixels(document);
    // ---- end MH-009 (Lane A A1) ----
  }
  setImageSlimgRuntimeState(document.id, {
    sourceVersion: read.sourceVersion,
    manifest: read.manifest,
    assets: allAssets,
    migrationWarnings: read.migrationWarnings,
    ...(read.migrationBackup ? { migrationBackup: read.migrationBackup } : {}),
  });
  return normalizeImageFrameAnimationDocument({
    ...document,
    dirty: false,
    metadata: {
      ...document.metadata,
      sourceFormat: 'slimg',
      warnings: [
        ...(document.metadata?.warnings ?? []),
        ...read.migrationWarnings,
      ],
    },
  });
}

/** Preserve v2 smart-source assets while restoring the embedded CMYKA authority. */
function mergeNativeCmykAuthority(generic: ImageDocument, native: ImageDocument): ImageDocument {
  if (generic.width !== native.width || generic.height !== native.height) {
    throw new Error('.slimg CMYK native archive dimensions do not match the v2 document.');
  }
  const nativeMetadata = native.metadata?.cmyk;
  if (!nativeMetadata) throw new Error('.slimg native CMYK archive is missing profile metadata.');
  const nativeLayers = new Map(native.layers.map((layer) => [layer.id, layer]));
  for (const layer of native.layers) {
    if (layer.cmykPixels && !generic.layers.some((candidate) => candidate.id === layer.id)) {
      throw new Error(`.slimg CMYK native layer ${layer.id} is missing from the v2 document.`);
    }
  }
  return {
    ...generic,
    metadata: { ...generic.metadata, colorMode: 'cmyk', cmyk: { ...nativeMetadata } },
    layers: generic.layers.map((layer) => {
      const authoritative = nativeLayers.get(layer.id);
      if (!authoritative?.cmykPixels) return layer;
      if (layer.bitmap && (layer.bitmap.width !== authoritative.cmykPixels.width || layer.bitmap.height !== authoritative.cmykPixels.height)) {
        throw new Error(`.slimg CMYK authority dimensions for layer ${layer.id} do not match its v2 display proxy.`);
      }
      return {
        ...layer,
        cmykPixels: cloneImageCmykPixelBuffer(authoritative.cmykPixels),
        cmykPixelsData: undefined,
      };
    }),
  };
}

function isV1Manifest(value: unknown): boolean {
  return Boolean(
    typeof value === 'object'
    && value !== null
    && (value as { formatVersion?: unknown }).formatVersion === 1,
  );
}

export async function serializeSlimgV2(
  document: ImageDocument,
  codec: SlimgCodec,
): Promise<Uint8Array> {
  const parts = await buildSlimgV2Parts(document, codec);
  const bytes = packContainer(
    parts.manifest as unknown as ContainerManifest,
    parts.assets,
  );
  const verificationArchive = parseArchive(bytes);
  const verified = await readSlimgManifest(
    verificationArchive.manifest,
    verificationArchive.assets,
    { manifestByteLength: verificationArchive.manifestByteLength },
  );
  if (verified.sourceVersion !== 2) {
    throw new Error('.slimg v2 save verification returned the wrong format version.');
  }
  setImageSlimgRuntimeState(document.id, {
    sourceVersion: 2,
    manifest: verified.manifest,
    assets: verificationArchive.assets,
    migrationWarnings: [],
    ...(getImageSlimgRuntimeState(document.id)?.migrationBackup
      ? { migrationBackup: getImageSlimgRuntimeState(document.id)!.migrationBackup }
      : {}),
  });
  return bytes;
}

export async function serializeSlimgV1Compatibility(
  document: ImageDocument,
  codec: SlimgCodec,
): Promise<SerializedSlimgV1Compatibility> {
  const parts = await buildSlimgV2Parts(document, codec);
  const copy = exportSlimgV1CompatibilityCopy(parts.manifest, parts.assets);
  return {
    bytes: packContainer(
      copy.manifest as unknown as ContainerManifest,
      copy.assets,
    ),
    report: copy.report,
  };
}
