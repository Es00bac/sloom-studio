import { sha256Hex as portableSha256Hex } from '../shared/crypto/sha256';

export const SLIMG_FORMAT = 'signal-loom-image' as const;
export const SLIMG_V2_FORMAT_VERSION = 2 as const;

export const SLIMG_V2_LIMITS = Object.freeze({
  maxManifestBytes: 8 * 1024 * 1024,
  maxDocumentEdge: 8192,
  maxDocumentPixels: 8192 * 8192,
  maxLayers: 2048,
  maxLayerHierarchyDepth: 64,
  maxAssets: 4096,
  maxAssetBytes: 192 * 1024 * 1024,
  maxTotalAssetBytes: 512 * 1024 * 1024,
  maxLayerNameLength: 240,
  maxTextLength: 1_000_000,
  maxVectorRecipeBytes: 4 * 1024 * 1024,
  maxGuides: 1024,
  maxGuidePoints: 64,
  maxTimelapseChunks: 4096,
  maxWarpColumns: 8,
  maxWarpRows: 8,
});

export type SlimgV2AssetRole =
  | 'pixels'
  | 'mask'
  | 'selection-mask'
  | 'raster-fallback'
  | 'icc-profile'
  | 'font'
  | 'timelapse'
  | 'tiltmark-state'
  | 'physical-state'
  | 'smart-source'
   // ---- MH-009 (Lane A A1) high-bit pixel authorities ----
   | 'layer-pixels-u16'
   | 'layer-pixels-f32'
   // ---- end MH-009 ----
  | 'migration-backup'
  | 'other';

export interface SlimgV2AssetRecord {
  id: string;
  sha256: string;
  byteLength: number;
  mimeType: string;
  role: SlimgV2AssetRole;
  fileName?: string;
}

export interface SlimgV2BitmapAssetRef {
  assetId: string;
  width: number;
  height: number;
}

export interface SlimgV2AlphaMaskRef extends SlimgV2BitmapAssetRef {
  encoding: 'alpha8';
}

export interface SlimgV2Point {
  x: number;
  y: number;
}

export interface SlimgV2LayerTransform {
  affine: [number, number, number, number, number, number];
  skew?: { xRad: number; yRad: number };
  perspective?: {
    matrix: [
      number, number, number,
      number, number, number,
      number, number, number,
    ];
  };
  cornerDistort?: {
    topLeft: SlimgV2Point;
    topRight: SlimgV2Point;
    bottomRight: SlimgV2Point;
    bottomLeft: SlimgV2Point;
  };
  warpMesh?: {
    columns: number;
    rows: number;
    points: SlimgV2Point[];
  };
}

export const IDENTITY_SLIMG_V2_TRANSFORM: SlimgV2LayerTransform = Object.freeze({
  affine: [1, 0, 0, 1, 0, 0],
}) as SlimgV2LayerTransform;

export type SlimgV2BlendMode =
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
  | 'exclusion';

/** C2 local Smart Filter records remain editable in `.slimg`; they are not native PSD Smart Filters. */
export type SlimgV2SmartFilterKind =
  | 'blur'
  | 'sharpen'
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'noise'
  | 'pixelate'
  | 'denoise';

export type SlimgV2SmartFilterBlendMode = SlimgV2BlendMode | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface SlimgV2SmartFilter {
  id: string;
  kind: SlimgV2SmartFilterKind;
  enabled: boolean;
  amount: number;
  opacity: number;
  blendMode: SlimgV2SmartFilterBlendMode;
  /** Bounded alpha asset for C2's local per-filter mask; not a native PSD mask. */
  mask?: SlimgV2AlphaMaskRef;
}

interface SlimgV2LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  alphaLocked: boolean;
  opacity: number;
  blendMode: SlimgV2BlendMode;
  clippingMask: boolean;
  parentId?: string;
  transform: SlimgV2LayerTransform;
  mask?: {
    bitmap: SlimgV2AlphaMaskRef;
    enabled: boolean;
    density: number;
    featherPx: number;
  };
  /** A linked consumer references another layer's editable raster mask rather than duplicating it. */
  maskLinkSourceLayerId?: string;
  rasterFallback?: SlimgV2BitmapAssetRef;
  substrateProfile?: JsonObject;
  smartObject?: { sourceId: string; placement: { width: number; height: number }; renderedVersion: number };
  /** Present only for a C2 Smart Object; all sibling instances serialize the same local stack. */
  smartFilters?: SlimgV2SmartFilter[];
}

export interface SlimgV2RasterLayer extends SlimgV2LayerBase {
  kind: 'raster';
  pixels: SlimgV2BitmapAssetRef | null;
}

export interface SlimgV2VectorLayer extends SlimgV2LayerBase {
  kind: 'vector';
  vector: {
    format: string;
    recipe: JsonValue;
  };
  rasterFallback: SlimgV2BitmapAssetRef;
}

export type SlimgV2TextDirection = 'horizontal' | 'vertical-rl' | 'vertical-lr';

export interface SlimgV2TextLayer extends SlimgV2LayerBase {
  kind: 'text';
  text: {
    content: string;
    direction: SlimgV2TextDirection;
    fontFamily: string;
    fontAssetId?: string;
    fontWeight: number;
    fontStyle: 'normal' | 'italic' | 'oblique';
    fontSizePx: number;
    kerning: boolean;
    letterSpacingPx: number;
    baselineShiftPx: number;
    lineHeight: number;
    alignment: 'start' | 'center' | 'end' | 'justify';
    wrapWidthPx?: number;
    /** Retained Image text-warp intent; omitted means the portable default, none. */
    warp?: 'arc' | 'flag' | 'bulge';
    fill: string;
    stroke?: {
      color: string;
      widthPx: number;
    };
  };
  rasterFallback: SlimgV2BitmapAssetRef;
}

export type SlimgV2AdjustmentKind =
  | 'brightness-contrast'
  | 'levels'
  | 'curves'
  | 'hsl'
  | 'exposure'
  | 'temperature-tint'
  | 'color-balance'
  | 'black-and-white'
  | 'invert'
  | 'gradient-map'
  | 'channel-mixer'
  | 'selective-color'
  | 'lut'
  | 'gaussian-blur'
  | 'sharpen'
  | 'noise'
  | 'pixelate';

export interface SlimgV2AdjustmentLayer extends SlimgV2LayerBase {
  kind: 'adjustment';
  adjustment: {
    kind: SlimgV2AdjustmentKind;
    parameters: JsonObject;
    clippingAware: boolean;
  };
  rasterFallback: SlimgV2BitmapAssetRef;
}

export interface SlimgV2GroupLayer extends SlimgV2LayerBase {
  kind: 'group';
  expanded: boolean;
  /** Omitted means the backward-compatible isolated group default. */
  passThrough?: boolean;
}

export type SlimgV2Layer =
  | SlimgV2RasterLayer
  | SlimgV2VectorLayer
  | SlimgV2TextLayer
  | SlimgV2AdjustmentLayer
  | SlimgV2GroupLayer;

export type SlimgV2GuideKind =
  | 'grid'
  | 'isometric'
  | 'perspective-one-point'
  | 'perspective-two-point'
  | 'perspective-three-point'
  | 'ruler'
  | 'ellipse'
  | 'french-curve';

export interface SlimgV2Guide {
  id: string;
  kind: SlimgV2GuideKind;
  enabled: boolean;
  assisted: boolean;
  opacity: number;
  spacingPx?: number;
  angleRad?: number;
  points: SlimgV2Point[];
}

export interface SlimgV2ColorSettings {
  workingSpace: 'srgb' | 'display-p3';
  workingProfileAssetId?: string;
  proof?: {
    profileAssetId: string;
    sourceSpace: 'cmyk';
    intent: 'relative-colorimetric' | 'perceptual';
    blackPointCompensation: boolean;
    gamutWarning: boolean;
  };
}

export interface SlimgV2Timelapse {
  initialKeyframeAssetId: string;
  durationMs: number;
  chunks: Array<{
    assetId: string;
    timestampMs: number;
    kind: 'keyframe' | 'dirty-tile-delta';
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface SlimgV2PhysicalState {
  version: number;
  paperProfile?: JsonObject;
  documentStateAssetId?: string;
  layers: Array<{
    layerId: string;
    stateAssetId: string;
    byteLength: number;
    tileCount?: number;
    baseBitmap?: SlimgV2BitmapAssetRef;
    legacyWetFieldVersion?: 1;
    /** Hane v2 wet-field contract: base bitmap + substrate is authoritative. */
    presentationAuthority?: 'base-bitmap-plus-substrate';
  }>;
}

export interface SlimgV2Selection {
  mask: SlimgV2AlphaMaskRef;
  sourceLayerId?: string;
  recipe?: {
    kind: 'rectangle' | 'ellipse' | 'lasso';
    points: SlimgV2Point[];
  };
}

/**
 * Namespaced Sloom extension. The referenced, hashed v1-compatible native
 * document is an implementation detail, not a second save authority: v2
 * remains authoritative and other readers use the explicit layer fallbacks.
 */
export interface SlimgV2SloomStudioExtension {
  schemaVersion: 1;
  nativeDocumentAssetId: string;
}

// ---- MH-009 (Lane A A1) high-bit document persistence ----
/**
 * Retained high-bit pixel authorities for a working-depth document. Assets
 * hold raw little-endian interleaved RGBA samples; the ordinary 8-bit pixel
 * assets remain the display proxy. Readers without this feature must refuse
 * via `requiredFeatures` rather than silently keeping the proxy as authority.
 */
export interface SlimgV2HighBitLayerPixels {
  layerId: string;
  pixels: SlimgV2BitmapAssetRef;
  encoding: 'srgb-u16-le' | 'linear-f32-le';
  /** bitmapVersion the authority was last derived from; higher means the proxy diverged. */
  sourceBitmapVersion: number;
}

export interface SlimgV2HighBitState {
  version: 1;
  bitDepth: 16 | 32;
  layers: SlimgV2HighBitLayerPixels[];
  /** True when at least one authority's sourceBitmapVersion trails its layer's proxy at save time. */
  diverged?: boolean;
}
// ---- end MH-009 (Lane A A1) ----

export interface SlimgV2Document {
  id: string;
  title: string;
  width: number;
  height: number;
  dpi: number;
  background: 'paper' | 'white' | 'transparent';
  activeLayerId: string;
  layers: SlimgV2Layer[];
  selection?: SlimgV2Selection;
  guides: SlimgV2Guide[];
  color: SlimgV2ColorSettings;
  timelapse?: SlimgV2Timelapse;
  physical?: SlimgV2PhysicalState;
  migrationBackupAssetId?: string;
  sourceApplication: string;
  sloomStudio?: SlimgV2SloomStudioExtension;
  smartSources?: Array<{ id: string; kind: 'embedded' | 'linked'; mimeType: string; byteLength: number; sha256: string; nativeWidth: number; nativeHeight: number; label: string; version: number; bytesAssetId?: string; linkedSourceLibraryItemId?: string }>;
   // ---- MH-009 (Lane A A1) ----
   highBit?: SlimgV2HighBitState;
   /** Feature names a reader must understand; unknown names fail closed. */
   requiredFeatures?: string[];
   // ---- end MH-009 (Lane A A1) ----
}

export interface SlimgV2Manifest {
  format: typeof SLIMG_FORMAT;
  formatVersion: typeof SLIMG_V2_FORMAT_VERSION;
  kind: 'image';
  generator: {
    name: string;
    version: number;
    brushEngine?: string;
  };
  document: SlimgV2Document;
  assets: SlimgV2AssetRecord[];
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export type SlimgSha256Hasher = (bytes: Uint8Array) => string | Promise<string>;

export interface SlimgV2ReadResult {
  manifest: SlimgV2Manifest;
  sourceVersion: 1 | 2;
  migrated: boolean;
  migrationWarnings: string[];
  migrationBackup?: {
    record: SlimgV2AssetRecord;
    bytes: Uint8Array;
  };
}

export interface SlimgV2CompatibilityFlattenedLayer {
  layerId: string;
  layerName: string;
  reasons: Array<
    | 'vector-recipe'
    | 'editable-text'
    | 'adjustment-layer'
    | 'affine-scale-or-shear'
    | 'skew'
    | 'perspective'
    | 'corner-distort'
    | 'warp-mesh'
  >;
  fallbackAssetId: string;
}

export interface SlimgV2CompatibilityOmission {
  feature: 'guides' | 'managed-color' | 'soft-proof' | 'timelapse' | 'physical-state';
  detail: string;
  assetIds: string[];
}

export interface SlimgV1CompatibilityReport {
  sourceVersion: 2;
  targetVersion: 1;
  flattenedLayers: SlimgV2CompatibilityFlattenedLayer[];
  omittedDocumentFeatures: SlimgV2CompatibilityOmission[];
  retainedAssetIds: string[];
  omittedAssetIds: string[];
}

export interface SlimgV1CompatibilityCopy {
  manifest: {
    format: typeof SLIMG_FORMAT;
    formatVersion: 1;
    kind: 'image';
    generator: SlimgV2Manifest['generator'];
    document: Record<string, unknown>;
    assets: string[];
  };
  assets: Map<string, Uint8Array>;
  report: SlimgV1CompatibilityReport;
}

type UnknownRecord = Record<string, unknown>;

const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const ASSET_ROLES = new Set<SlimgV2AssetRole>([
  'pixels', 'mask', 'selection-mask', 'raster-fallback', 'icc-profile',
  'font', 'timelapse', 'tiltmark-state', 'physical-state',
  'layer-pixels-u16', 'layer-pixels-f32',
  'migration-backup', 'other',
  'smart-source',
]);
// ---- MH-009 (Lane A A1) ----
/** Feature names this reader understands; anything else in requiredFeatures refuses. */
export const KNOWN_SLIMG_V2_FEATURES = new Set<string>(['high-bit-pixels']);
const HIGH_BIT_ROLES_BY_DEPTH: Record<number, SlimgV2AssetRole> = {
  16: 'layer-pixels-u16',
  32: 'layer-pixels-f32',
};
const HIGH_BIT_ENCODINGS_BY_DEPTH: Record<number, string> = {
  16: 'srgb-u16-le',
  32: 'linear-f32-le',
};
// ---- end MH-009 (Lane A A1) ----
const BLEND_MODES = new Set<SlimgV2BlendMode>([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
]);
const SMART_FILTER_BLEND_MODES = new Set<SlimgV2SmartFilterBlendMode>([
  ...BLEND_MODES, 'hue', 'saturation', 'color', 'luminosity',
]);
const SMART_FILTER_KINDS = new Set<SlimgV2SmartFilterKind>([
  'blur', 'sharpen', 'grayscale', 'sepia', 'invert', 'noise', 'pixelate', 'denoise',
]);
const GUIDE_KINDS = new Set<SlimgV2GuideKind>([
  'grid', 'isometric', 'perspective-one-point', 'perspective-two-point',
  'perspective-three-point', 'ruler', 'ellipse', 'french-curve',
]);
const ADJUSTMENT_KINDS = new Set<SlimgV2AdjustmentKind>([
  'brightness-contrast', 'levels', 'curves', 'hsl', 'exposure',
  'temperature-tint', 'color-balance', 'black-and-white', 'invert',
  'gradient-map', 'channel-mixer', 'selective-color', 'lut', 'gaussian-blur', 'sharpen', 'noise', 'pixelate',
]);

function fail(message: string): never {
  throw new Error(`.slimg v2: ${message}`);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 1024,
): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length < minimum
    || value.length > maximum
    || value.includes('\0')
  ) fail(`${field} is not a bounded string.`);
}

function bool(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(`${field} must be boolean.`);
}

function finite(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) fail(`${field} is outside its numeric bounds.`);
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  finite(value, field, minimum, maximum);
  if (!Number.isSafeInteger(value)) fail(`${field} must be a safe integer.`);
}

function assetId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !ASSET_ID.test(value)) {
    fail(`${field} is not a safe asset identifier.`);
  }
}

function point(value: unknown, field: string, bound: number): asserts value is SlimgV2Point {
  if (!isRecord(value)) fail(`${field} must be a point.`);
  finite(value.x, `${field}.x`, -bound, bound);
  finite(value.y, `${field}.y`, -bound, bound);
}

function jsonValue(
  value: unknown,
  field: string,
  budget: { nodes: number },
  depth = 0,
): asserts value is JsonValue {
  budget.nodes -= 1;
  if (budget.nodes < 0 || depth > 32) fail(`${field} exceeds structured-data bounds.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${field} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 65_536) fail(`${field} contains an oversized array.`);
    value.forEach((entry, index) => jsonValue(entry, `${field}[${index}]`, budget, depth + 1));
    return;
  }
  if (!isRecord(value)) fail(`${field} is not JSON data.`);
  const entries = Object.entries(value);
  if (entries.length > 4096) fail(`${field} contains too many keys.`);
  for (const [key, entry] of entries) {
    string(key, `${field} key`, 1, 240);
    jsonValue(entry, `${field}.${key}`, budget, depth + 1);
  }
}

function jsonObject(value: unknown, field: string): asserts value is JsonObject {
  if (!isRecord(value)) fail(`${field} must be a JSON object.`);
  jsonValue(value, field, { nodes: 200_000 });
}

function mapEntries(
  entries: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
): ReadonlyMap<string, Uint8Array> {
  return entries instanceof Map ? entries : new Map(Object.entries(entries));
}

function bitmapRef(
  value: unknown,
  field: string,
  assets: ReadonlyMap<string, SlimgV2AssetRecord>,
  width: number,
  height: number,
  roles?: ReadonlySet<SlimgV2AssetRole>,
): asserts value is SlimgV2BitmapAssetRef {
  if (!isRecord(value)) fail(`${field} must be an asset reference.`);
  assetId(value.assetId, `${field}.assetId`);
  integer(value.width, `${field}.width`, 1, width);
  integer(value.height, `${field}.height`, 1, height);
  const record = assets.get(value.assetId);
  if (!record) fail(`${field} references undeclared asset ${value.assetId}.`);
  if (roles && !roles.has(record.role)) {
    fail(`${field} references ${record.role}, not a permitted asset role.`);
  }
}

function alphaRef(
  value: unknown,
  field: string,
  assets: ReadonlyMap<string, SlimgV2AssetRecord>,
  width: number,
  height: number,
  roles: ReadonlySet<SlimgV2AssetRole>,
): asserts value is SlimgV2AlphaMaskRef {
  bitmapRef(value, field, assets, width, height, roles);
  if ((value as unknown as UnknownRecord).encoding !== 'alpha8') {
    fail(`${field} must use canonical alpha8 encoding.`);
  }
}

function transform(
  value: unknown,
  field: string,
  coordinateBound: number,
): asserts value is SlimgV2LayerTransform {
  if (!isRecord(value) || !Array.isArray(value.affine) || value.affine.length !== 6) {
    fail(`${field}.affine must contain six numbers.`);
  }
  value.affine.forEach((entry, index) => {
    finite(entry, `${field}.affine[${index}]`, -1_000_000, 1_000_000);
  });
  if (value.skew !== undefined) {
    if (!isRecord(value.skew)) fail(`${field}.skew must be an object.`);
    finite(value.skew.xRad, `${field}.skew.xRad`, -Math.PI * 4, Math.PI * 4);
    finite(value.skew.yRad, `${field}.skew.yRad`, -Math.PI * 4, Math.PI * 4);
  }
  if (value.perspective !== undefined) {
    if (
      !isRecord(value.perspective)
      || !Array.isArray(value.perspective.matrix)
      || value.perspective.matrix.length !== 9
    ) fail(`${field}.perspective.matrix must contain nine numbers.`);
    value.perspective.matrix.forEach((entry, index) => {
      finite(entry, `${field}.perspective.matrix[${index}]`, -1_000_000, 1_000_000);
    });
  }
  if (value.cornerDistort !== undefined) {
    if (!isRecord(value.cornerDistort)) fail(`${field}.cornerDistort must be an object.`);
    point(value.cornerDistort.topLeft, `${field}.cornerDistort.topLeft`, coordinateBound);
    point(value.cornerDistort.topRight, `${field}.cornerDistort.topRight`, coordinateBound);
    point(value.cornerDistort.bottomRight, `${field}.cornerDistort.bottomRight`, coordinateBound);
    point(value.cornerDistort.bottomLeft, `${field}.cornerDistort.bottomLeft`, coordinateBound);
  }
  if (value.warpMesh !== undefined) {
    if (!isRecord(value.warpMesh) || !Array.isArray(value.warpMesh.points)) {
      fail(`${field}.warpMesh must be a point grid.`);
    }
    integer(value.warpMesh.columns, `${field}.warpMesh.columns`, 2, SLIMG_V2_LIMITS.maxWarpColumns);
    integer(value.warpMesh.rows, `${field}.warpMesh.rows`, 2, SLIMG_V2_LIMITS.maxWarpRows);
    if (value.warpMesh.points.length !== value.warpMesh.columns * value.warpMesh.rows) {
      fail(`${field}.warpMesh point count does not match its grid.`);
    }
    value.warpMesh.points.forEach((entry, index) => {
      point(entry, `${field}.warpMesh.points[${index}]`, coordinateBound);
    });
  }
}

function validateAssetRecords(value: unknown): {
  records: SlimgV2AssetRecord[];
  byId: Map<string, SlimgV2AssetRecord>;
} {
  if (!Array.isArray(value) || value.length > SLIMG_V2_LIMITS.maxAssets) {
    fail('asset table exceeds its count bound.');
  }
  const byId = new Map<string, SlimgV2AssetRecord>();
  let totalBytes = 0;
  value.forEach((candidate, index) => {
    if (!isRecord(candidate)) fail(`assets[${index}] must be an object.`);
    assetId(candidate.id, `assets[${index}].id`);
    if (byId.has(candidate.id)) fail(`duplicate asset id ${candidate.id}.`);
    if (typeof candidate.sha256 !== 'string' || !SHA256.test(candidate.sha256)) {
      fail(`assets[${index}].sha256 is not canonical SHA-256.`);
    }
    integer(candidate.byteLength, `assets[${index}].byteLength`, 0, SLIMG_V2_LIMITS.maxAssetBytes);
    if (typeof candidate.mimeType !== 'string' || !MIME.test(candidate.mimeType)) {
      fail(`assets[${index}].mimeType is invalid.`);
    }
    if (!ASSET_ROLES.has(candidate.role as SlimgV2AssetRole)) {
      fail(`assets[${index}].role is unsupported.`);
    }
    if (candidate.fileName !== undefined) string(candidate.fileName, `assets[${index}].fileName`, 1, 240);
    totalBytes += candidate.byteLength;
    if (totalBytes > SLIMG_V2_LIMITS.maxTotalAssetBytes) {
      fail('aggregate asset bytes exceed the document limit.');
    }
    byId.set(candidate.id, candidate as unknown as SlimgV2AssetRecord);
  });
  return { records: value as SlimgV2AssetRecord[], byId };
}

function validateLayer(
  value: unknown,
  index: number,
  assets: ReadonlyMap<string, SlimgV2AssetRecord>,
  documentWidth: number,
  documentHeight: number,
): asserts value is SlimgV2Layer {
  const field = `document.layers[${index}]`;
  if (!isRecord(value)) fail(`${field} must be an object.`);
  string(value.id, `${field}.id`, 1, 240);
  string(value.name, `${field}.name`, 1, SLIMG_V2_LIMITS.maxLayerNameLength);
  if (!['raster', 'vector', 'group', 'text', 'adjustment'].includes(String(value.kind))) {
    fail(`${field}.kind is unsupported.`);
  }
  bool(value.visible, `${field}.visible`);
  bool(value.locked, `${field}.locked`);
  bool(value.alphaLocked, `${field}.alphaLocked`);
  finite(value.opacity, `${field}.opacity`, 0, 1);
  if (!BLEND_MODES.has(value.blendMode as SlimgV2BlendMode)) {
    fail(`${field}.blendMode is unsupported.`);
  }
  bool(value.clippingMask, `${field}.clippingMask`);
  if (value.parentId !== undefined) string(value.parentId, `${field}.parentId`, 1, 240);
  transform(value.transform, `${field}.transform`, Math.max(documentWidth, documentHeight) * 16);
  if (value.mask !== undefined) {
    if (!isRecord(value.mask)) fail(`${field}.mask must be an object.`);
    alphaRef(
      value.mask.bitmap,
      `${field}.mask.bitmap`,
      assets,
      documentWidth,
      documentHeight,
      new Set(['mask']),
    );
    bool(value.mask.enabled, `${field}.mask.enabled`);
    finite(value.mask.density, `${field}.mask.density`, 0, 1);
    finite(value.mask.featherPx, `${field}.mask.featherPx`, 0, Math.max(documentWidth, documentHeight));
  }
  if (value.maskLinkSourceLayerId !== undefined) {
    string(value.maskLinkSourceLayerId, `${field}.maskLinkSourceLayerId`, 1, 240);
  }
  if (value.rasterFallback !== undefined) {
    bitmapRef(
      value.rasterFallback,
      `${field}.rasterFallback`,
      assets,
      documentWidth,
      documentHeight,
      new Set(['raster-fallback', 'pixels']),
    );
  }
  if (value.substrateProfile !== undefined) jsonObject(value.substrateProfile, `${field}.substrateProfile`);
  if (value.smartFilters !== undefined) {
    if (!value.smartObject) fail(`${field}.smartFilters require a Smart Object source.`);
    if (!Array.isArray(value.smartFilters) || value.smartFilters.length > 32) {
      fail(`${field}.smartFilters is outside its count bound.`);
    }
    const ids = new Set<string>();
    value.smartFilters.forEach((filter, filterIndex) => {
      const filterField = `${field}.smartFilters[${filterIndex}]`;
      if (!isRecord(filter)) fail(`${filterField} must be an object.`);
      string(filter.id, `${filterField}.id`, 1, 128);
      if (ids.has(filter.id as string)) fail(`${field}.smartFilters contains duplicate ids.`);
      ids.add(filter.id as string);
      if (!SMART_FILTER_KINDS.has(filter.kind as SlimgV2SmartFilterKind)) {
        fail(`${filterField}.kind is unsupported.`);
      }
      bool(filter.enabled, `${filterField}.enabled`);
      const maximum = filter.kind === 'blur' || filter.kind === 'pixelate' ? 32 : 100;
      finite(filter.amount, `${filterField}.amount`, 0, maximum);
      finite(filter.opacity, `${filterField}.opacity`, 0, 1);
      if (!SMART_FILTER_BLEND_MODES.has(filter.blendMode as SlimgV2SmartFilterBlendMode)) {
        fail(`${filterField}.blendMode is unsupported.`);
      }
      if (filter.mask !== undefined) {
        alphaRef(
          filter.mask,
          `${filterField}.mask`,
          assets,
          documentWidth,
          documentHeight,
          new Set(['mask']),
        );
      }
    });
  }

  if (value.kind === 'raster') {
    if (value.pixels !== null) {
      bitmapRef(value.pixels, `${field}.pixels`, assets, documentWidth, documentHeight, new Set(['pixels']));
    }
    return;
  }
  if (value.kind === 'group') {
    bool(value.expanded, `${field}.expanded`);
    if (value.passThrough !== undefined) bool(value.passThrough, `${field}.passThrough`);
    return;
  }
  if (!value.rasterFallback) fail(`${field} requires a raster fallback.`);
  if (value.kind === 'vector') {
    if (!isRecord(value.vector)) fail(`${field}.vector must be an object.`);
    string(value.vector.format, `${field}.vector.format`, 1, 160);
    jsonValue(value.vector.recipe, `${field}.vector.recipe`, { nodes: 200_000 });
    if (new TextEncoder().encode(JSON.stringify(value.vector.recipe)).byteLength > SLIMG_V2_LIMITS.maxVectorRecipeBytes) {
      fail(`${field}.vector.recipe exceeds its byte limit.`);
    }
    return;
  }
  if (value.kind === 'text') {
    if (!isRecord(value.text)) fail(`${field}.text must be an object.`);
    string(value.text.content, `${field}.text.content`, 0, SLIMG_V2_LIMITS.maxTextLength);
    if (!['horizontal', 'vertical-rl', 'vertical-lr'].includes(String(value.text.direction))) {
      fail(`${field}.text.direction is unsupported.`);
    }
    string(value.text.fontFamily, `${field}.text.fontFamily`, 1, 240);
    if (value.text.fontAssetId !== undefined) {
      assetId(value.text.fontAssetId, `${field}.text.fontAssetId`);
      if (assets.get(value.text.fontAssetId)?.role !== 'font') {
        fail(`${field}.text.fontAssetId does not reference a font asset.`);
      }
    }
    integer(value.text.fontWeight, `${field}.text.fontWeight`, 1, 1000);
    if (!['normal', 'italic', 'oblique'].includes(String(value.text.fontStyle))) {
      fail(`${field}.text.fontStyle is unsupported.`);
    }
    finite(value.text.fontSizePx, `${field}.text.fontSizePx`, 0.1, 100_000);
    bool(value.text.kerning, `${field}.text.kerning`);
    finite(value.text.letterSpacingPx, `${field}.text.letterSpacingPx`, -10_000, 10_000);
    finite(value.text.baselineShiftPx, `${field}.text.baselineShiftPx`, -100_000, 100_000);
    finite(value.text.lineHeight, `${field}.text.lineHeight`, 0.01, 100);
    if (!['start', 'center', 'end', 'justify'].includes(String(value.text.alignment))) {
      fail(`${field}.text.alignment is unsupported.`);
    }
    if (value.text.wrapWidthPx !== undefined) {
      finite(value.text.wrapWidthPx, `${field}.text.wrapWidthPx`, 0.1, documentWidth * 16);
    }
    if (value.text.warp !== undefined && !['arc', 'flag', 'bulge'].includes(String(value.text.warp))) {
      fail(`${field}.text.warp is unsupported.`);
    }
    if (typeof value.text.fill !== 'string' || !HEX_COLOR.test(value.text.fill)) {
      fail(`${field}.text.fill is not a canonical color.`);
    }
    if (value.text.stroke !== undefined) {
      if (!isRecord(value.text.stroke)) fail(`${field}.text.stroke must be an object.`);
      if (typeof value.text.stroke.color !== 'string' || !HEX_COLOR.test(value.text.stroke.color)) {
        fail(`${field}.text.stroke.color is not a canonical color.`);
      }
      finite(value.text.stroke.widthPx, `${field}.text.stroke.widthPx`, 0, Math.max(documentWidth, documentHeight));
    }
    return;
  }
  if (!isRecord(value.adjustment)) fail(`${field}.adjustment must be an object.`);
  if (!ADJUSTMENT_KINDS.has(value.adjustment.kind as SlimgV2AdjustmentKind)) {
    fail(`${field}.adjustment.kind is unsupported.`);
  }
  jsonObject(value.adjustment.parameters, `${field}.adjustment.parameters`);
  bool(value.adjustment.clippingAware, `${field}.adjustment.clippingAware`);
}

function validateHierarchy(layers: readonly SlimgV2Layer[]): void {
  const byId = new Map<string, SlimgV2Layer>();
  for (const layer of layers) {
    if (byId.has(layer.id)) fail(`duplicate layer id ${layer.id}.`);
    byId.set(layer.id, layer);
  }
  for (const layer of layers) {
    if (!layer.parentId) continue;
    const parent = byId.get(layer.parentId);
    if (!parent) fail(`layer ${layer.id} references missing parent ${layer.parentId}.`);
    if (parent.kind !== 'group') fail(`layer ${layer.id} parent ${layer.parentId} is not a group.`);
    const visited = new Set<string>([layer.id]);
    let cursor: SlimgV2Layer | undefined = parent;
    let depth = 0;
    while (cursor) {
      if (visited.has(cursor.id)) fail(`layer hierarchy contains a cycle at ${cursor.id}.`);
      visited.add(cursor.id);
      depth += 1;
      if (depth > SLIMG_V2_LIMITS.maxLayerHierarchyDepth) {
        fail(`layer hierarchy depth exceeds ${SLIMG_V2_LIMITS.maxLayerHierarchyDepth}.`);
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
}

export function validateSlimgV2Manifest(
  value: unknown,
  manifestByteLength?: number,
): SlimgV2Manifest {
  if (
    manifestByteLength !== undefined
    && manifestByteLength > SLIMG_V2_LIMITS.maxManifestBytes
  ) fail('manifest byte size exceeds its limit.');
  if (!isRecord(value)) fail('manifest must be an object.');
  if (value.format !== SLIMG_FORMAT || value.formatVersion !== 2 || value.kind !== 'image') {
    fail('manifest identity is unsupported.');
  }
  if (!isRecord(value.generator)) fail('generator must be an object.');
  string(value.generator.name, 'generator.name', 1, 240);
  integer(value.generator.version, 'generator.version', 1, 1_000_000);
  if (value.generator.brushEngine !== undefined) {
    string(value.generator.brushEngine, 'generator.brushEngine', 1, 240);
  }
  const { byId: assets } = validateAssetRecords(value.assets);
  if (!isRecord(value.document)) fail('document must be an object.');
  const document = value.document;
  string(document.id, 'document.id', 1, 240);
  string(document.title, 'document.title', 1, 1024);
  integer(document.width, 'document.width', 1, SLIMG_V2_LIMITS.maxDocumentEdge);
  integer(document.height, 'document.height', 1, SLIMG_V2_LIMITS.maxDocumentEdge);
  if (document.width * document.height > SLIMG_V2_LIMITS.maxDocumentPixels) {
    fail('document pixel count exceeds its limit.');
  }
  finite(document.dpi, 'document.dpi', 36, 1200);
  if (!['paper', 'white', 'transparent'].includes(String(document.background))) {
    fail('document.background is unsupported.');
  }
  string(document.activeLayerId, 'document.activeLayerId', 1, 240);
  if (!Array.isArray(document.layers) || document.layers.length < 1
    || document.layers.length > SLIMG_V2_LIMITS.maxLayers) {
    fail('document.layers is outside its count bound.');
  }
  document.layers.forEach((layer, index) => {
    validateLayer(layer, index, assets, document.width as number, document.height as number);
  });
  const layers = document.layers as SlimgV2Layer[];
  validateHierarchy(layers);
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  layers.forEach((layer, index) => {
    if (!layer.maskLinkSourceLayerId) return;
    if (layer.mask) fail(`document.layers[${index}] cannot carry both a mask and a linked mask reference.`);
    const source = layersById.get(layer.maskLinkSourceLayerId);
    if (!source || source.id === layer.id || source.maskLinkSourceLayerId || !source.mask) {
      fail(`document.layers[${index}].maskLinkSourceLayerId must reference a direct layer mask source.`);
    }
  });
  if (!(document.layers as SlimgV2Layer[]).some((layer) => layer.id === document.activeLayerId)) {
    fail(`document.activeLayerId references missing layer ${String(document.activeLayerId)}.`);
  }
  if (document.smartSources !== undefined) {
    if (!Array.isArray(document.smartSources) || document.smartSources.length > 2048) fail('document.smartSources is outside its count bound.');
    const ids = new Set<string>(); let total = 0;
    for (const [index, source] of document.smartSources.entries()) {
      if (!isRecord(source)) fail(`document.smartSources[${index}] must be an object.`);
      string(source.id, `document.smartSources[${index}].id`, 1, 240);
      if (ids.has(source.id as string)) fail('document.smartSources contains duplicate ids.'); ids.add(source.id as string);
      if (source.kind !== 'embedded' && source.kind !== 'linked') fail(`document.smartSources[${index}].kind is unsupported.`);
      string(source.mimeType, `document.smartSources[${index}].mimeType`, 1, 127);
      integer(source.byteLength, `document.smartSources[${index}].byteLength`, 1, 64 * 1024 * 1024); total += source.byteLength as number;
      if (!SHA256.test(String(source.sha256))) fail(`document.smartSources[${index}].sha256 is invalid.`);
      integer(source.nativeWidth, `document.smartSources[${index}].nativeWidth`, 1, SLIMG_V2_LIMITS.maxDocumentEdge);
      integer(source.nativeHeight, `document.smartSources[${index}].nativeHeight`, 1, SLIMG_V2_LIMITS.maxDocumentEdge);
      string(source.label, `document.smartSources[${index}].label`, 1, 240); integer(source.version, `document.smartSources[${index}].version`, 1, 1_000_000);
      if (source.kind === 'embedded') {
        assetId(source.bytesAssetId, `document.smartSources[${index}].bytesAssetId`);
        const asset = assets.get(source.bytesAssetId as string);
        if (!asset || asset.role !== 'smart-source' || asset.byteLength !== source.byteLength || asset.sha256 !== source.sha256) fail(`document.smartSources[${index}] source asset is invalid.`);
      }
    }
    if (total > 256 * 1024 * 1024) fail('document.smartSources exceed the total byte limit.');
    for (const [index, layer] of layers.entries()) {
      if (!layer.smartObject) continue;
      if (!ids.has(layer.smartObject.sourceId) || !Number.isFinite(layer.smartObject.placement.width) || !Number.isFinite(layer.smartObject.placement.height) || layer.smartObject.placement.width < 1 || layer.smartObject.placement.height < 1 || layer.smartObject.placement.width > SLIMG_V2_LIMITS.maxDocumentEdge || layer.smartObject.placement.height > SLIMG_V2_LIMITS.maxDocumentEdge) fail(`document.layers[${index}].smartObject is invalid.`);
    }
  }
  if (document.selection !== undefined) {
    if (!isRecord(document.selection)) fail('document.selection must be an object.');
    alphaRef(
      document.selection.mask,
      'document.selection.mask',
      assets,
      document.width as number,
      document.height as number,
      new Set(['selection-mask']),
    );
    const selectionMask = document.selection.mask as unknown as SlimgV2AlphaMaskRef;
    if (selectionMask.width !== document.width || selectionMask.height !== document.height) {
      fail('document.selection.mask must match document dimensions.');
    }
    if (document.selection.sourceLayerId !== undefined) {
      string(document.selection.sourceLayerId, 'document.selection.sourceLayerId', 1, 240);
      const sourceLayerId = document.selection.sourceLayerId;
      if (!(document.layers as SlimgV2Layer[]).some((layer) => layer.id === sourceLayerId)) {
        fail('document.selection.sourceLayerId references a missing layer.');
      }
    }
    if (document.selection.recipe !== undefined) {
      if (!isRecord(document.selection.recipe)
        || !['rectangle', 'ellipse', 'lasso'].includes(String(document.selection.recipe.kind))
        || !Array.isArray(document.selection.recipe.points)
        || document.selection.recipe.points.length > SLIMG_V2_LIMITS.maxGuidePoints) {
        fail('document.selection.recipe is malformed.');
      }
      document.selection.recipe.points.forEach((entry, index) => {
        point(entry, `document.selection.recipe.points[${index}]`, Math.max(document.width as number, document.height as number) * 16);
      });
    }
  }
  if (!Array.isArray(document.guides) || document.guides.length > SLIMG_V2_LIMITS.maxGuides) {
    fail('document.guides exceeds its count bound.');
  }
  document.guides.forEach((candidate, index) => {
    const field = `document.guides[${index}]`;
    if (!isRecord(candidate)) fail(`${field} must be an object.`);
    string(candidate.id, `${field}.id`, 1, 240);
    if (!GUIDE_KINDS.has(candidate.kind as SlimgV2GuideKind)) fail(`${field}.kind is unsupported.`);
    bool(candidate.enabled, `${field}.enabled`);
    bool(candidate.assisted, `${field}.assisted`);
    finite(candidate.opacity, `${field}.opacity`, 0, 1);
    if (candidate.spacingPx !== undefined) finite(candidate.spacingPx, `${field}.spacingPx`, 0.01, 1_000_000);
    if (candidate.angleRad !== undefined) finite(candidate.angleRad, `${field}.angleRad`, -Math.PI * 16, Math.PI * 16);
    if (!Array.isArray(candidate.points) || candidate.points.length > SLIMG_V2_LIMITS.maxGuidePoints) {
      fail(`${field}.points exceeds its count bound.`);
    }
    candidate.points.forEach((entry, pointIndex) => {
      point(entry, `${field}.points[${pointIndex}]`, Math.max(document.width as number, document.height as number) * 16);
    });
  });
  if (!isRecord(document.color)
    || !['srgb', 'display-p3'].includes(String(document.color.workingSpace))) {
    fail('document.color is malformed.');
  }
  if (document.color.workingProfileAssetId !== undefined) {
    assetId(document.color.workingProfileAssetId, 'document.color.workingProfileAssetId');
    if (assets.get(document.color.workingProfileAssetId)?.role !== 'icc-profile') {
      fail('document.color.workingProfileAssetId does not reference an ICC asset.');
    }
  }
  if (document.color.proof !== undefined) {
    if (!isRecord(document.color.proof)) fail('document.color.proof must be an object.');
    assetId(document.color.proof.profileAssetId, 'document.color.proof.profileAssetId');
    if (assets.get(document.color.proof.profileAssetId)?.role !== 'icc-profile') {
      fail('document.color.proof.profileAssetId does not reference an ICC asset.');
    }
    if (document.color.proof.sourceSpace !== 'cmyk'
      || !['relative-colorimetric', 'perceptual'].includes(String(document.color.proof.intent))) {
      fail('document.color.proof mode is unsupported.');
    }
    bool(document.color.proof.blackPointCompensation, 'document.color.proof.blackPointCompensation');
    bool(document.color.proof.gamutWarning, 'document.color.proof.gamutWarning');
  }
  if (document.timelapse !== undefined) {
    if (!isRecord(document.timelapse)) fail('document.timelapse must be an object.');
    assetId(document.timelapse.initialKeyframeAssetId, 'document.timelapse.initialKeyframeAssetId');
    if (assets.get(document.timelapse.initialKeyframeAssetId)?.role !== 'timelapse') {
      fail('document.timelapse.initialKeyframeAssetId does not reference a timelapse asset.');
    }
    finite(document.timelapse.durationMs, 'document.timelapse.durationMs', 0, Number.MAX_SAFE_INTEGER);
    if (!Array.isArray(document.timelapse.chunks)
      || document.timelapse.chunks.length > SLIMG_V2_LIMITS.maxTimelapseChunks) {
      fail('document.timelapse.chunks exceeds its count bound.');
    }
    let previousTimestamp = -1;
    const timelapseDuration = document.timelapse.durationMs;
    const documentWidth = document.width;
    const documentHeight = document.height;
    document.timelapse.chunks.forEach((chunk, index) => {
      const field = `document.timelapse.chunks[${index}]`;
      if (!isRecord(chunk)) fail(`${field} must be an object.`);
      assetId(chunk.assetId, `${field}.assetId`);
      if (assets.get(chunk.assetId)?.role !== 'timelapse') {
        fail(`${field}.assetId does not reference a timelapse asset.`);
      }
      finite(chunk.timestampMs, `${field}.timestampMs`, previousTimestamp, timelapseDuration);
      previousTimestamp = chunk.timestampMs;
      if (!['keyframe', 'dirty-tile-delta'].includes(String(chunk.kind))) {
        fail(`${field}.kind is unsupported.`);
      }
      integer(chunk.x, `${field}.x`, 0, document.width as number);
      integer(chunk.y, `${field}.y`, 0, document.height as number);
      integer(chunk.width, `${field}.width`, 1, document.width as number);
      integer(chunk.height, `${field}.height`, 1, document.height as number);
      if (chunk.x + chunk.width > documentWidth || chunk.y + chunk.height > documentHeight) {
        fail(`${field} extends outside the document.`);
      }
    });
  }
  if (document.physical !== undefined) {
    if (!isRecord(document.physical)) fail('document.physical must be an object.');
    integer(document.physical.version, 'document.physical.version', 1, 1_000_000);
    if (document.physical.paperProfile !== undefined) {
      jsonObject(document.physical.paperProfile, 'document.physical.paperProfile');
    }
    if (document.physical.documentStateAssetId !== undefined) {
      assetId(document.physical.documentStateAssetId, 'document.physical.documentStateAssetId');
      if (assets.get(document.physical.documentStateAssetId)?.role !== 'physical-state') {
        fail('document.physical.documentStateAssetId does not reference physical state.');
      }
    }
    if (!Array.isArray(document.physical.layers)
      || document.physical.layers.length > document.layers.length) {
      fail('document.physical.layers exceeds its count bound.');
    }
    const physicalLayerIds = new Set<string>();
    document.physical.layers.forEach((candidate, index) => {
      const field = `document.physical.layers[${index}]`;
      if (!isRecord(candidate)) fail(`${field} must be an object.`);
      string(candidate.layerId, `${field}.layerId`, 1, 240);
      if (physicalLayerIds.has(candidate.layerId)) fail(`duplicate physical layer ${candidate.layerId}.`);
      physicalLayerIds.add(candidate.layerId);
      if (!(document.layers as SlimgV2Layer[]).some((layer) => layer.id === candidate.layerId)) {
        fail(`${field}.layerId references a missing layer.`);
      }
      assetId(candidate.stateAssetId, `${field}.stateAssetId`);
      const state = assets.get(candidate.stateAssetId);
      if (!state || !['physical-state', 'tiltmark-state'].includes(state.role)) {
        fail(`${field}.stateAssetId does not reference physical state.`);
      }
      integer(candidate.byteLength, `${field}.byteLength`, 0, SLIMG_V2_LIMITS.maxAssetBytes);
      if (candidate.byteLength !== state.byteLength) fail(`${field}.byteLength does not match its asset.`);
      if (candidate.tileCount !== undefined) integer(candidate.tileCount, `${field}.tileCount`, 0, 1_000_000);
      if (candidate.baseBitmap !== undefined) {
        bitmapRef(candidate.baseBitmap, `${field}.baseBitmap`, assets, document.width as number, document.height as number, new Set(['pixels', 'raster-fallback']));
      }
      if (candidate.legacyWetFieldVersion !== undefined && candidate.legacyWetFieldVersion !== 1) {
        fail(`${field}.legacyWetFieldVersion is unsupported.`);
      }
      if (
        candidate.presentationAuthority !== undefined
        && candidate.presentationAuthority !== 'base-bitmap-plus-substrate'
      ) {
        fail(`${field}.presentationAuthority is unsupported.`);
      }
      if (
        candidate.presentationAuthority !== undefined
        && candidate.legacyWetFieldVersion !== undefined
      ) {
        fail(`${field} cannot declare both legacy and v2 wet-field authority.`);
      }
    });
  }
  if (document.migrationBackupAssetId !== undefined) {
    assetId(document.migrationBackupAssetId, 'document.migrationBackupAssetId');
    if (assets.get(document.migrationBackupAssetId)?.role !== 'migration-backup') {
      fail('document.migrationBackupAssetId does not reference a migration backup.');
    }
  }
  if (document.sloomStudio !== undefined) {
    if (!isRecord(document.sloomStudio) || document.sloomStudio.schemaVersion !== 1) {
      fail('document.sloomStudio extension is malformed.');
    }
    assetId(document.sloomStudio.nativeDocumentAssetId, 'document.sloomStudio.nativeDocumentAssetId');
    if (assets.get(document.sloomStudio.nativeDocumentAssetId)?.role !== 'other') {
      fail('document.sloomStudio.nativeDocumentAssetId does not reference native data.');
    }
  }
  // ---- MH-009 (Lane A A1) ----
  if (document.requiredFeatures !== undefined) {
    if (!Array.isArray(document.requiredFeatures) || document.requiredFeatures.length > 16) {
      fail('document.requiredFeatures is malformed.');
    }
    document.requiredFeatures.forEach((feature, index) => {
      string(feature, `document.requiredFeatures[${index}]`, 1, 64);
      if (!KNOWN_SLIMG_V2_FEATURES.has(feature)) {
        fail(`document requires unsupported feature "${feature}"; this reader is too old for the file.`);
      }
    });
  }
  if (document.highBit !== undefined) {
    const highBit = document.highBit;
    if (!isRecord(highBit) || highBit.version !== 1
      || (highBit.bitDepth !== 16 && highBit.bitDepth !== 32)) {
      fail('document.highBit is malformed.');
    }
    if (!Array.isArray(highBit.layers) || highBit.layers.length < 1
      || highBit.layers.length > (document.layers as SlimgV2Layer[]).length) {
      fail('document.highBit.layers is outside its count bound.');
    }
    const seenLayerIds = new Set<string>();
    const owningRasterRefs = new Map(
      (document.layers as SlimgV2Layer[]).map((layer) => [
        layer.id,
        layer.kind === 'raster' ? layer.pixels : layer.rasterFallback,
      ] as const),
    );
    highBit.layers.forEach((candidate, index) => {
      const field = `document.highBit.layers[${index}]`;
      if (!isRecord(candidate)) fail(`${field} must be an object.`);
      string(candidate.layerId, `${field}.layerId`, 1, 240);
      if (seenLayerIds.has(candidate.layerId)) fail(`${field} duplicates layer ${candidate.layerId}.`);
      seenLayerIds.add(candidate.layerId);
      if (!(document.layers as SlimgV2Layer[]).some((layer) => layer.id === candidate.layerId)) {
        fail(`${field}.layerId references a missing layer.`);
      }
      if (candidate.encoding !== HIGH_BIT_ENCODINGS_BY_DEPTH[highBit.bitDepth as number]) {
        fail(`${field}.encoding does not match the declared working depth.`);
      }
      const ownerRaster = owningRasterRefs.get(candidate.layerId);
      if (!ownerRaster) {
        fail(`${field}.layerId has no owning layer raster dimensions.`);
      }
      bitmapRef(candidate.pixels, `${field}.pixels`, assets, ownerRaster.width, ownerRaster.height,
        new Set([HIGH_BIT_ROLES_BY_DEPTH[highBit.bitDepth as number]]));
      if (candidate.pixels.width !== ownerRaster.width || candidate.pixels.height !== ownerRaster.height) {
        fail(`${field}.pixels dimensions must exactly match the owning layer raster.`);
      }
      integer(candidate.sourceBitmapVersion, `${field}.sourceBitmapVersion`, 0, 1_000_000_000);
    });
    if (highBit.diverged !== undefined) bool(highBit.diverged, 'document.highBit.diverged');
  }
  // ---- end MH-009 (Lane A A1) ----
  string(document.sourceApplication, 'document.sourceApplication', 1, 240);
  return value as unknown as SlimgV2Manifest;
}

export function sha256Hex(bytes: Uint8Array): string {
  return portableSha256Hex(bytes);
}

export async function createSlimgV2AssetRecord(
  id: string,
  bytes: Uint8Array,
  metadata: Pick<SlimgV2AssetRecord, 'mimeType' | 'role' | 'fileName'>,
  hasher: SlimgSha256Hasher = sha256Hex,
): Promise<SlimgV2AssetRecord> {
  assetId(id, 'asset id');
  if (bytes.byteLength > SLIMG_V2_LIMITS.maxAssetBytes) fail(`asset ${id} exceeds its byte limit.`);
  if (!MIME.test(metadata.mimeType)) fail(`asset ${id} has an invalid MIME type.`);
  if (!ASSET_ROLES.has(metadata.role)) fail(`asset ${id} has an unsupported role.`);
  if (metadata.fileName !== undefined) string(metadata.fileName, `asset ${id} fileName`, 1, 240);
  return {
    id,
    sha256: await hasher(bytes),
    byteLength: bytes.byteLength,
    mimeType: metadata.mimeType,
    role: metadata.role,
    ...(metadata.fileName ? { fileName: metadata.fileName } : {}),
  };
}

export async function verifySlimgV2Assets(
  manifest: SlimgV2Manifest,
  entries: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
  hasher: SlimgSha256Hasher = sha256Hex,
): Promise<void> {
  const validated = validateSlimgV2Manifest(manifest);
  const bytesById = mapEntries(entries);
  const declared = new Map(validated.assets.map((record) => [record.id, record]));
  for (const id of bytesById.keys()) {
    if (!declared.has(id)) fail(`archive contains undeclared asset ${id}.`);
  }
  for (const record of validated.assets) {
    const bytes = bytesById.get(record.id);
    if (!bytes) fail(`archive is missing asset ${record.id}.`);
    if (bytes.byteLength !== record.byteLength) fail(`asset ${record.id} failed its byte-length check.`);
    if (await hasher(bytes) !== record.sha256) fail(`asset ${record.id} failed its SHA-256 check.`);
  }
}

function legacyRef(value: unknown): { asset: string; width: number; height: number } | null {
  if (!isRecord(value)
    || typeof value.asset !== 'string'
    || !ASSET_ID.test(value.asset)
    || !Number.isSafeInteger(value.width)
    || !Number.isSafeInteger(value.height)
    || Number(value.width) < 1
    || Number(value.height) < 1) return null;
  return { asset: value.asset, width: Number(value.width), height: Number(value.height) };
}

function legacyRole(id: string, document: UnknownRecord): Pick<SlimgV2AssetRecord, 'mimeType' | 'role'> {
  if (id === (legacyRef(document.selectionMask)?.asset ?? '')) {
    return { mimeType: 'application/octet-stream', role: 'selection-mask' };
  }
  const layers = Array.isArray(document.layers) ? document.layers : [];
  for (const candidate of layers) {
    if (!isRecord(candidate)) continue;
    if (legacyRef(candidate.mask)?.asset === id) return { mimeType: 'image/png', role: 'mask' };
    if (legacyRef(candidate.bitmap)?.asset === id) return { mimeType: 'image/png', role: 'pixels' };
    if (legacyRef(candidate.tiltmarkBaseBitmap)?.asset === id) return { mimeType: 'image/png', role: 'pixels' };
    if (isRecord(candidate.tiltmarkSimulationData) && candidate.tiltmarkSimulationData.asset === id) {
      return { mimeType: 'application/json', role: 'tiltmark-state' };
    }
    if (isRecord(candidate.haneWetField) && candidate.haneWetField.asset === id) {
      return { mimeType: 'application/json', role: 'physical-state' };
    }
  }
  return id.toLowerCase().endsWith('.png')
    ? { mimeType: 'image/png', role: 'pixels' }
    : { mimeType: 'application/octet-stream', role: 'other' };
}

function legacyBlendMode(value: unknown): SlimgV2BlendMode {
  return BLEND_MODES.has(value as SlimgV2BlendMode) ? value as SlimgV2BlendMode : 'normal';
}

function legacyAdjustment(value: unknown): SlimgV2AdjustmentLayer['adjustment'] {
  const candidate = isRecord(value) ? value : {};
  const kindMap: Record<string, SlimgV2AdjustmentKind> = {
    brightnessContrast: 'brightness-contrast',
    hueSaturation: 'hsl',
    blackWhite: 'black-and-white',
    invert: 'invert',
    exposure: 'exposure',
    temperatureTint: 'temperature-tint',
    levels: 'levels',
    curves: 'curves',
  };
  const kind = kindMap[String(candidate.kind)] ?? 'invert';
  return {
    kind,
    parameters: structuredClone(candidate) as JsonObject,
    clippingAware: true,
  };
}

function legacyText(value: unknown): SlimgV2TextLayer['text'] {
  const candidate = isRecord(value) ? value : {};
  const weight = Number.parseInt(String(candidate.fontWeight ?? 400), 10);
  const align = candidate.align === 'center'
    ? 'center'
    : candidate.align === 'right'
      ? 'end'
      : candidate.align === 'justify'
        ? 'justify'
        : 'start';
  const orientation = ['vertical-rl', 'vertical-lr'].includes(String(candidate.orientation))
    ? candidate.orientation as 'vertical-rl' | 'vertical-lr'
    : 'horizontal';
  return {
    content: typeof candidate.content === 'string'
      ? candidate.content.slice(0, SLIMG_V2_LIMITS.maxTextLength)
      : '',
    direction: orientation,
    fontFamily: typeof candidate.fontFamily === 'string' && candidate.fontFamily
      ? candidate.fontFamily.slice(0, 240)
      : 'sans-serif',
    fontWeight: Number.isFinite(weight) ? Math.max(1, Math.min(1000, weight)) : 400,
    fontStyle: ['italic', 'oblique'].includes(String(candidate.fontStyle))
      ? candidate.fontStyle as 'italic' | 'oblique'
      : 'normal',
    fontSizePx: typeof candidate.fontSize === 'number' && candidate.fontSize > 0
      ? candidate.fontSize
      : 16,
    kerning: candidate.fontKerning !== 'none',
    letterSpacingPx: typeof candidate.letterSpacing === 'number' ? candidate.letterSpacing : 0,
    baselineShiftPx: typeof candidate.baselineShift === 'number' ? candidate.baselineShift : 0,
    lineHeight: typeof candidate.lineHeight === 'number' && candidate.lineHeight > 0
      ? candidate.lineHeight
      : 1.2,
    alignment: align,
    ...(typeof candidate.boxWidth === 'number' && candidate.boxWidth > 0
      ? { wrapWidthPx: candidate.boxWidth }
      : {}),
    ...(['arc', 'flag', 'bulge'].includes(String(candidate.warp))
      ? { warp: candidate.warp as 'arc' | 'flag' | 'bulge' }
      : {}),
    fill: typeof candidate.color === 'string' && HEX_COLOR.test(candidate.color)
      ? candidate.color
      : '#000000',
  };
}

export function migrateSlimgV1Manifest(
  value: unknown,
  assets: SlimgV2AssetRecord[],
): { manifest: SlimgV2Manifest; warnings: string[] } {
  if (!isRecord(value) || value.format !== SLIMG_FORMAT || value.formatVersion !== 1
    || !isRecord(value.document)) fail('v1 manifest is malformed.');
  const source = value.document;
  integer(source.width, 'v1 document.width', 1, SLIMG_V2_LIMITS.maxDocumentEdge);
  integer(source.height, 'v1 document.height', 1, SLIMG_V2_LIMITS.maxDocumentEdge);
  if (source.width * source.height > SLIMG_V2_LIMITS.maxDocumentPixels) {
    fail('v1 document pixel count exceeds migration bounds.');
  }
  if (!Array.isArray(source.layers) || source.layers.length < 1
    || source.layers.length > SLIMG_V2_LIMITS.maxLayers) {
    fail('v1 document layer count exceeds migration bounds.');
  }
  const warnings: string[] = [];
  const layers = source.layers.map((candidate, index): SlimgV2Layer => {
    if (!isRecord(candidate)) fail(`v1 layer ${index} is malformed.`);
    const id = typeof candidate.id === 'string' && candidate.id
      ? candidate.id.slice(0, 240)
      : `migrated-layer-${index}`;
    const name = typeof candidate.name === 'string' && candidate.name
      ? candidate.name.slice(0, SLIMG_V2_LIMITS.maxLayerNameLength)
      : `Layer ${index + 1}`;
    const bitmap = legacyRef(candidate.bitmap);
    const mask = legacyRef(candidate.mask);
    const common = {
      id,
      name,
      visible: candidate.visible !== false,
      locked: candidate.locked === true,
      alphaLocked: candidate.alphaLocked === true,
      opacity: typeof candidate.opacity === 'number'
        ? Math.max(0, Math.min(1, candidate.opacity))
        : 1,
      blendMode: legacyBlendMode(candidate.blendMode),
      clippingMask: candidate.clippingMask === true,
      ...(typeof candidate.groupId === 'string' && candidate.groupId
        ? { parentId: candidate.groupId.slice(0, 240) }
        : {}),
      transform: {
        affine: (() => {
          const angle = (typeof candidate.rotationDeg === 'number' ? candidate.rotationDeg : 0) * Math.PI / 180;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          return [
            cosine, sine, -sine, cosine,
            typeof candidate.x === 'number' ? candidate.x : 0,
            typeof candidate.y === 'number' ? candidate.y : 0,
          ] as [number, number, number, number, number, number];
        })(),
        ...(typeof candidate.skewXDeg === 'number' || typeof candidate.skewYDeg === 'number'
          ? {
              skew: {
                xRad: (typeof candidate.skewXDeg === 'number' ? candidate.skewXDeg : 0) * Math.PI / 180,
                yRad: (typeof candidate.skewYDeg === 'number' ? candidate.skewYDeg : 0) * Math.PI / 180,
              },
            }
          : {}),
      },
      ...(mask ? {
        mask: {
          bitmap: {
            assetId: mask.asset,
            width: mask.width,
            height: mask.height,
            encoding: 'alpha8' as const,
          },
          enabled: candidate.maskEnabled !== false,
          density: typeof candidate.maskDensity === 'number'
            ? Math.max(0, Math.min(1, candidate.maskDensity))
            : 1,
          featherPx: typeof candidate.maskFeather === 'number'
            ? Math.max(0, candidate.maskFeather)
            : 0,
        },
      } : {}),
      ...(isRecord(candidate.haneSubstrateProfile)
        ? { substrateProfile: candidate.haneSubstrateProfile as JsonObject }
        : {}),
    };
    const fallback = bitmap
      ? { assetId: bitmap.asset, width: bitmap.width, height: bitmap.height }
      : null;
    const type = String(candidate.type ?? 'image');
    if (type === 'group') {
      return {
        ...common,
        kind: 'group',
        expanded: candidate.groupExpanded !== false,
        ...(candidate.groupPassThrough === true ? { passThrough: true } : {}),
      };
    }
    if (type === 'vector' || typeof candidate.vectorRecipe === 'string') {
      if (!fallback) fail(`v1 vector layer ${id} has no raster fallback.`);
      let recipe: JsonValue = [];
      if (Array.isArray(candidate.haneVectorObjects)) recipe = candidate.haneVectorObjects as JsonValue;
      else if (typeof candidate.vectorRecipe === 'string') recipe = { source: candidate.vectorRecipe };
      return {
        ...common,
        kind: 'vector',
        vector: {
          format: Array.isArray(candidate.haneVectorObjects)
            ? 'hane-vector-objects-v1'
            : 'sloom-svg-v1',
          recipe,
        },
        rasterFallback: fallback,
      };
    }
    if (type === 'text' || isRecord(candidate.text)) {
      if (!fallback) fail(`v1 text layer ${id} has no raster fallback.`);
      return { ...common, kind: 'text', text: legacyText(candidate.text), rasterFallback: fallback };
    }
    if (type === 'adjustment' || isRecord(candidate.adjustment)) {
      if (!fallback) fail(`v1 adjustment layer ${id} has no raster fallback.`);
      return {
        ...common,
        kind: 'adjustment',
        adjustment: legacyAdjustment(candidate.adjustment),
        rasterFallback: fallback,
      };
    }
    return { ...common, kind: 'raster', pixels: fallback };
  });
  const requestedActive = typeof source.activeLayerId === 'string' ? source.activeLayerId : '';
  const activeLayerId = layers.some((layer) => layer.id === requestedActive)
    ? requestedActive
    : layers.find((layer) => layer.kind !== 'group')?.id ?? layers[0]!.id;
  const selection = legacyRef(source.selectionMask);
  const rawGenerator = isRecord(value.generator) ? value.generator : {};
  const manifest: SlimgV2Manifest = {
    format: SLIMG_FORMAT,
    formatVersion: 2,
    kind: 'image',
    generator: {
      name: typeof rawGenerator.name === 'string' && rawGenerator.name
        ? rawGenerator.name.slice(0, 240)
        : 'Sloom Studio v1 migrator',
      version: Number.isSafeInteger(rawGenerator.version) && Number(rawGenerator.version) > 0
        ? Number(rawGenerator.version)
        : 1,
      ...(typeof rawGenerator.brushEngine === 'string' && rawGenerator.brushEngine
        ? { brushEngine: rawGenerator.brushEngine.slice(0, 240) }
        : {}),
    },
    document: {
      id: typeof source.id === 'string' && source.id
        ? source.id.slice(0, 240)
        : 'migrated-v1-document',
      title: typeof source.title === 'string' && source.title
        ? source.title.slice(0, 1024)
        : 'Migrated artwork',
      width: source.width,
      height: source.height,
      dpi: typeof source.dpi === 'number'
        ? Math.max(36, Math.min(1200, source.dpi))
        : 300,
      background: ['white', 'transparent'].includes(String(source.background))
        ? source.background as 'white' | 'transparent'
        : 'paper',
      activeLayerId,
      layers,
      ...(selection && source.hasSelection === true ? {
        selection: {
          mask: {
            assetId: selection.asset,
            width: selection.width,
            height: selection.height,
            encoding: 'alpha8',
          },
        },
      } : {}),
      guides: [],
      color: { workingSpace: 'srgb' },
      sourceApplication: typeof source.sourceApplication === 'string' && source.sourceApplication
        ? source.sourceApplication.slice(0, 240)
        : 'Sloom Studio v1 migration',
    },
    assets,
  };
  return { manifest: validateSlimgV2Manifest(manifest), warnings };
}

function v1AssetIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.assets)
    || value.assets.length > SLIMG_V2_LIMITS.maxAssets) {
    fail('v1 manifest has no bounded asset list.');
  }
  const seen = new Set<string>();
  return value.assets.map((id, index) => {
    assetId(id, `v1 assets[${index}]`);
    if (seen.has(id)) fail(`v1 manifest contains duplicate asset ${id}.`);
    seen.add(id);
    return id;
  });
}

export async function readSlimgManifest(
  value: unknown,
  assetEntries: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
  options: {
    manifestByteLength?: number;
    hasher?: SlimgSha256Hasher;
    originalV1ArchiveBytes?: Uint8Array;
    migrationBackupAssetId?: string;
  } = {},
): Promise<SlimgV2ReadResult> {
  if (!isRecord(value) || value.format !== SLIMG_FORMAT) fail('not a Sloom Studio image manifest.');
  const entries = mapEntries(assetEntries);
  const hasher = options.hasher ?? sha256Hex;
  if (value.formatVersion === 2) {
    const manifest = validateSlimgV2Manifest(value, options.manifestByteLength);
    await verifySlimgV2Assets(manifest, entries, hasher);
    return { manifest, sourceVersion: 2, migrated: false, migrationWarnings: [] };
  }
  if (value.formatVersion !== 1) fail(`format version ${String(value.formatVersion)} is unsupported.`);
  if (options.manifestByteLength !== undefined
    && options.manifestByteLength > SLIMG_V2_LIMITS.maxManifestBytes) {
    fail('v1 manifest byte size exceeds migration bounds.');
  }
  if (!isRecord(value.document)) fail('v1 document manifest is malformed.');
  const ids = v1AssetIds(value);
  for (const id of entries.keys()) {
    if (!ids.includes(id)) fail(`v1 archive contains undeclared asset ${id}.`);
  }
  let total = 0;
  const records: SlimgV2AssetRecord[] = [];
  for (const id of ids) {
    const bytes = entries.get(id);
    if (!bytes) fail(`v1 archive is missing asset ${id}.`);
    total += bytes.byteLength;
    if (bytes.byteLength > SLIMG_V2_LIMITS.maxAssetBytes
      || total > SLIMG_V2_LIMITS.maxTotalAssetBytes) {
      fail('v1 assets exceed migration bounds.');
    }
    records.push(await createSlimgV2AssetRecord(id, bytes, legacyRole(id, value.document), hasher));
  }
  let migrationBackup: SlimgV2ReadResult['migrationBackup'];
  if (options.originalV1ArchiveBytes) {
    const id = options.migrationBackupAssetId ?? 'original-v1-migration-backup.slimg';
    const record = await createSlimgV2AssetRecord(
      id,
      options.originalV1ArchiveBytes,
      {
        mimeType: 'application/x-sloom-slimg',
        role: 'migration-backup',
        fileName: 'original-v1.slimg',
      },
      hasher,
    );
    records.push(record);
    migrationBackup = { record, bytes: new Uint8Array(options.originalV1ArchiveBytes) };
  }
  const migrated = migrateSlimgV1Manifest(value, records);
  if (migrationBackup) {
    migrated.manifest.document.migrationBackupAssetId = migrationBackup.record.id;
    validateSlimgV2Manifest(migrated.manifest);
  }
  return {
    manifest: migrated.manifest,
    sourceVersion: 1,
    migrated: true,
    migrationWarnings: migrated.warnings,
    ...(migrationBackup ? { migrationBackup } : {}),
  };
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function legacyTransform(transformValue: SlimgV2LayerTransform): {
  x: number;
  y: number;
  rotationDeg: number;
  unsupported: SlimgV2CompatibilityFlattenedLayer['reasons'];
} {
  const [a, b, c, d, x, y] = transformValue.affine;
  const rotation = Math.atan2(b, a);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const unsupported: SlimgV2CompatibilityFlattenedLayer['reasons'] = [];
  if (!approximatelyEqual(a, cosine) || !approximatelyEqual(b, sine)
    || !approximatelyEqual(c, -sine) || !approximatelyEqual(d, cosine)) {
    unsupported.push('affine-scale-or-shear');
  }
  if (transformValue.skew) unsupported.push('skew');
  if (transformValue.perspective) unsupported.push('perspective');
  if (transformValue.cornerDistort) unsupported.push('corner-distort');
  if (transformValue.warpMesh) unsupported.push('warp-mesh');
  return { x, y, rotationDeg: rotation * 180 / Math.PI, unsupported };
}

function retainRef(target: Set<string>, ref: SlimgV2BitmapAssetRef | null | undefined): void {
  if (ref) target.add(ref.assetId);
}

export function exportSlimgV1CompatibilityCopy(
  source: SlimgV2Manifest,
  sourceAssets: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
): SlimgV1CompatibilityCopy {
  const manifest = validateSlimgV2Manifest(source);
  const available = mapEntries(sourceAssets);
  const retained = new Set<string>();
  const flattenedLayers: SlimgV2CompatibilityFlattenedLayer[] = [];
  const layers = manifest.document.layers.map((layer) => {
    const mappedTransform = legacyTransform(layer.transform);
    const reasons = [...mappedTransform.unsupported];
    if (layer.kind === 'vector' && layer.vector.format !== 'hane-vector-objects-v1') {
      reasons.unshift('vector-recipe');
    }
    if (layer.kind === 'text') reasons.unshift('editable-text');
    if (layer.kind === 'adjustment') reasons.unshift('adjustment-layer');
    const fallback = reasons.length > 0
      ? layer.rasterFallback ?? (layer.kind === 'raster' ? layer.pixels : null)
      : layer.kind === 'raster'
        ? layer.pixels
        : layer.kind === 'group'
          ? null
          : layer.rasterFallback;
    if (reasons.length > 0) {
      if (!fallback) fail(`layer ${layer.id} cannot be flattened without a raster fallback.`);
      flattenedLayers.push({
        layerId: layer.id,
        layerName: layer.name,
        reasons: [...new Set(reasons)],
        fallbackAssetId: fallback.assetId,
      });
    }
    retainRef(retained, fallback);
    if (layer.mask) retained.add(layer.mask.bitmap.assetId);
    const common = {
      id: layer.id,
      name: layer.name,
      type: layer.kind === 'group'
        ? 'group'
        : layer.kind === 'vector' && reasons.length === 0
          ? 'vector'
          : 'image',
      visible: layer.visible,
      locked: layer.locked,
      alphaLocked: layer.alphaLocked,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      ...(layer.clippingMask ? { clippingMask: true } : {}),
      ...(layer.parentId ? { groupId: layer.parentId } : {}),
      x: reasons.length > 0 ? 0 : mappedTransform.x,
      y: reasons.length > 0 ? 0 : mappedTransform.y,
      rotationDeg: reasons.length > 0 ? 0 : mappedTransform.rotationDeg,
      bitmap: fallback
        ? { asset: fallback.assetId, width: fallback.width, height: fallback.height }
        : null,
      bitmapVersion: fallback ? 1 : 0,
      mask: layer.mask
        ? {
            asset: layer.mask.bitmap.assetId,
            width: layer.mask.bitmap.width,
            height: layer.mask.bitmap.height,
          }
        : null,
      maskEnabled: layer.mask?.enabled ?? true,
      maskDensity: layer.mask?.density ?? 1,
      maskFeather: layer.mask?.featherPx ?? 0,
      ...(layer.substrateProfile ? { haneSubstrateProfile: layer.substrateProfile } : {}),
    };
    if (layer.kind === 'group') {
      return {
        ...common,
        groupExpanded: layer.expanded,
        ...(layer.passThrough === true ? { groupPassThrough: true } : {}),
      };
    }
    if (layer.kind === 'vector' && reasons.length === 0) {
      return {
        ...common,
        vectorRecipe: 'hane-rasterized-vector-layer:v1',
        haneVectorObjects: layer.vector.recipe,
      };
    }
    return common;
  });

  const omissions: SlimgV2CompatibilityOmission[] = [];
  if (manifest.document.guides.length > 0) {
    omissions.push({
      feature: 'guides',
      detail: `${manifest.document.guides.length} editable drawing guide(s) are not represented in v1.`,
      assetIds: [],
    });
  }
  const colorAssetIds = [
    manifest.document.color.workingProfileAssetId,
    manifest.document.color.proof?.profileAssetId,
  ].filter((value): value is string => Boolean(value));
  if (manifest.document.color.workingSpace !== 'srgb'
    || manifest.document.color.workingProfileAssetId) {
    omissions.push({
      feature: 'managed-color',
      detail: `The ${manifest.document.color.workingSpace} working-space metadata is not represented in v1.`,
      assetIds: manifest.document.color.workingProfileAssetId
        ? [manifest.document.color.workingProfileAssetId]
        : [],
    });
  }
  if (manifest.document.color.proof) {
    omissions.push({
      feature: 'soft-proof',
      detail: `${manifest.document.color.proof.intent} CMYK soft-proof settings are not represented in v1.`,
      assetIds: [manifest.document.color.proof.profileAssetId],
    });
  }
  if (manifest.document.timelapse) {
    omissions.push({
      feature: 'timelapse',
      detail: `${manifest.document.timelapse.chunks.length} timelapse chunk(s) are omitted from v1.`,
      assetIds: [
        manifest.document.timelapse.initialKeyframeAssetId,
        ...manifest.document.timelapse.chunks.map((chunk) => chunk.assetId),
      ],
    });
  }
  const legacyWetFields = new Map<string, SlimgV2PhysicalState['layers'][number]>();
  if (manifest.document.physical) {
    for (const physicalLayer of manifest.document.physical.layers) {
      if (physicalLayer.legacyWetFieldVersion === 1 && physicalLayer.baseBitmap) {
        legacyWetFields.set(physicalLayer.layerId, physicalLayer);
        retained.add(physicalLayer.stateAssetId);
        retained.add(physicalLayer.baseBitmap.assetId);
      }
    }
    const unsupportedAssetIds = [
      manifest.document.physical.documentStateAssetId,
      ...manifest.document.physical.layers
        .filter((layer) => layer.legacyWetFieldVersion !== 1)
        .map((layer) => layer.stateAssetId),
    ].filter((value): value is string => Boolean(value));
    if (unsupportedAssetIds.length > 0 || manifest.document.physical.version > 1) {
      omissions.push({
        feature: 'physical-state',
        detail: `Physical extension v${manifest.document.physical.version} is baked into raster fallbacks; only legacy wet-field v1 states remain editable.`,
        assetIds: unsupportedAssetIds,
      });
    }
  }
  const legacyLayers = layers.map((layer) => {
    const physical = legacyWetFields.get(String(layer.id));
    if (!physical?.baseBitmap) return layer;
    return {
      ...layer,
      haneWetField: {
        version: 1,
        asset: physical.stateAssetId,
        byteLength: physical.byteLength,
        tileCount: physical.tileCount ?? 0,
        baseBitmap: {
          asset: physical.baseBitmap.assetId,
          width: physical.baseBitmap.width,
          height: physical.baseBitmap.height,
        },
      },
    };
  });
  if (manifest.document.selection) retained.add(manifest.document.selection.mask.assetId);
  const retainedAssetIds = [...retained].sort();
  const copiedAssets = new Map<string, Uint8Array>();
  for (const id of retainedAssetIds) {
    const bytes = available.get(id);
    if (!bytes) fail(`compatibility export is missing source asset ${id}.`);
    copiedAssets.set(id, bytes);
  }
  const omittedAssetIds = [
    ...new Set([
      ...manifest.assets.map((record) => record.id).filter((id) => !retained.has(id)),
      ...colorAssetIds.filter((id) => !retained.has(id)),
    ]),
  ].sort();
  const selection = manifest.document.selection;
  return {
    manifest: {
      format: SLIMG_FORMAT,
      formatVersion: 1,
      kind: 'image',
      generator: manifest.generator,
      document: {
        id: manifest.document.id,
        title: manifest.document.title,
        width: manifest.document.width,
        height: manifest.document.height,
        dpi: manifest.document.dpi,
        background: manifest.document.background,
        layers: legacyLayers,
        activeLayerId: manifest.document.activeLayerId,
        hasSelection: Boolean(selection),
        selectionVersion: selection ? 1 : 0,
        selectionMask: selection
          ? {
              asset: selection.mask.assetId,
              width: selection.mask.width,
              height: selection.mask.height,
            }
          : null,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
        sourceApplication: manifest.document.sourceApplication,
        ...(manifest.document.physical?.paperProfile
          ? { hanePaperProfile: manifest.document.physical.paperProfile }
          : {}),
      },
      assets: retainedAssetIds,
    },
    assets: copiedAssets,
    report: {
      sourceVersion: 2,
      targetVersion: 1,
      flattenedLayers,
      omittedDocumentFeatures: omissions,
      retainedAssetIds,
      omittedAssetIds,
    },
  };
}
