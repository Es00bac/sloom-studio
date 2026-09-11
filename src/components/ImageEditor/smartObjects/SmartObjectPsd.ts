import type {
  Filter as PsdFilter,
  Layer as PsdLayer,
  LinkedFile,
  Psd,
  PlacedLayer,
  PixelData,
} from 'ag-psd';

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const PLACEMENT_NUMBER_COUNT = 8;

export type SmartObjectPsdFilterKind = 'gaussian-blur' | 'box-blur';

export interface SmartObjectPsdFilterRecord {
  kind: SmartObjectPsdFilterKind;
  radius: number;
  enabled?: boolean;
}

export interface SmartObjectPsdSourceRecord {
  id: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface SmartObjectPsdPlacement {
  transform: readonly number[];
  width: number;
  height: number;
}

export interface SmartObjectPsdRecord {
  source: SmartObjectPsdSourceRecord;
  placement: SmartObjectPsdPlacement;
  filters?: readonly SmartObjectPsdFilterRecord[];
  renderedImageData?: PixelData;
}

export interface SmartObjectPsdLayerInterchange {
  placedLayer: PlacedLayer;
  linkedFile: LinkedFile;
}

export interface SmartObjectPsdReadRecord {
  layerIndex: number[];
  sourceId: string | null;
  source: SmartObjectPsdSourceRecord | null;
  placement: SmartObjectPsdPlacement | null;
  filters: SmartObjectPsdFilterRecord[];
  unsupportedFilters: string[];
  previewOnly: boolean;
  reason?: string;
}

export interface SmartObjectPsdLayerReadback {
  layer: PsdLayer;
  interchange: SmartObjectPsdReadRecord;
}

/**
 * C3's temporary bridge for the C1 document model. C1 can either expose the
 * record directly on a layer or translate its richer source registry into this
 * record before calling the PSD writer. Invalid values are ignored here so a
 * normal raster layer remains on the existing export path.
 */
export function getSmartObjectPsdRecord(value: unknown): SmartObjectPsdRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = (value as { smartObjectPsd?: unknown }).smartObjectPsd;
  if (!candidate || typeof candidate !== 'object') return undefined;
  const record = candidate as Partial<SmartObjectPsdRecord>;
  if (!record.source || !record.placement) return undefined;
  return record as SmartObjectPsdRecord;
}

export function writeSmartObjectPsdInterchange(
  record: SmartObjectPsdRecord,
): SmartObjectPsdLayerInterchange {
  validateSource(record.source);
  const placement = validatePlacement(record.placement);
  const id = normalizeGuid(record.source.id);
  const placedLayer: PlacedLayer = {
    id,
    placed: id,
    type: 'raster',
    transform: [...placement.transform],
    width: placement.width,
    height: placement.height,
  };
  const filters = normalizeFilters(record.filters ?? []);
  if (filters.length > 0) {
    placedLayer.filter = {
      enabled: true,
      validAtPosition: true,
      maskEnabled: false,
      maskLinked: false,
      maskExtendWithWhite: false,
      list: filters,
    };
  }
  return {
    placedLayer,
    linkedFile: {
      id,
      name: record.source.name,
      type: record.source.mimeType,
      data: new Uint8Array(record.source.bytes),
    },
  };
}

export function attachSmartObjectPsdInterchange(
  psd: Psd,
  records: readonly SmartObjectPsdRecord[],
): Psd {
  if (records.length === 0) return psd;
  const existingIds = new Set((psd.linkedFiles ?? []).map((file) => file.id));
  const existingFiles = new Map((psd.linkedFiles ?? []).map((file) => [file.id, file]));
  const linkedFiles = [...(psd.linkedFiles ?? [])];
  for (const record of records) {
    const { linkedFile } = writeSmartObjectPsdInterchange(record);
    const existing = existingFiles.get(linkedFile.id);
    if (existing && !byteArraysEqual(existing.data, linkedFile.data)) {
      throw new Error(`Smart Object linkedFiles id collision: ${linkedFile.id}.`);
    }
    if (!existingIds.has(linkedFile.id)) {
      linkedFiles.push(linkedFile);
      existingIds.add(linkedFile.id);
      existingFiles.set(linkedFile.id, linkedFile);
    }
  }
  return { ...psd, linkedFiles };
}

export function readSmartObjectPsdInterchange(psd: Psd): SmartObjectPsdLayerReadback[] {
  const linkedFiles = new Map((psd.linkedFiles ?? []).map((file) => [file.id, file]));
  const duplicateLinkedFileIds = new Set<string>();
  const seenLinkedFileIds = new Set<string>();
  for (const file of psd.linkedFiles ?? []) {
    if (seenLinkedFileIds.has(file.id)) duplicateLinkedFileIds.add(file.id);
    seenLinkedFileIds.add(file.id);
  }
  const output: SmartObjectPsdLayerReadback[] = [];
  const visit = (layers: readonly PsdLayer[], path: number[]): void => {
    layers.forEach((layer, index) => {
      const layerPath = [...path, index];
      if (layer.placedLayer) {
        output.push({
          layer,
            interchange: readPlacedLayer(layer.placedLayer, linkedFiles, duplicateLinkedFileIds, layerPath),
        });
      }
      if (layer.children) visit(layer.children, layerPath);
    });
  };
  visit(psd.children ?? [], []);
  return output;
}

function readPlacedLayer(
  placedLayer: PlacedLayer,
  linkedFiles: ReadonlyMap<string, LinkedFile>,
  duplicateLinkedFileIds: ReadonlySet<string>,
  layerIndex: number[],
): SmartObjectPsdReadRecord {
  const placement = tryValidatePlacement(placedLayer);
  const linked = typeof placedLayer.id === 'string' ? linkedFiles.get(placedLayer.id) : undefined;
  const duplicateLinkedFile = typeof placedLayer.id === 'string' && duplicateLinkedFileIds.has(placedLayer.id);
  const source = !duplicateLinkedFile && linked?.data && linked.data.byteLength > 0 && linked.data.byteLength <= MAX_SOURCE_BYTES
    ? {
      id: placedLayer.id,
      name: linked.name || 'Embedded Smart Object',
      mimeType: inferMimeType(linked.type, linked.data),
      bytes: new Uint8Array(linked.data),
    }
    : null;
  const filters = placedLayer.filter?.list ?? [];
  const mapped = filters.flatMap(mapPsdFilter);
  const unsupportedFilters = filters
    .filter((filter) => !isSupportedPsdFilter(filter))
    .map((filter) => filter.type);
  const reason = duplicateLinkedFile
    ? 'The linkedFiles table contains duplicate entries for this placed-layer id.'
    : !placement
    ? 'The placed-layer transform or dimensions are invalid.'
    : !linked
      ? 'The placed-layer linkedFiles entry is missing.'
      : !linked.data
        ? 'The linkedFiles entry has no embedded bytes.'
        : linked.data.byteLength === 0
          ? 'The linkedFiles entry has empty embedded bytes.'
          : linked.data.byteLength > MAX_SOURCE_BYTES
            ? `The embedded source exceeds the ${MAX_SOURCE_BYTES / (1024 * 1024)} MiB limit.`
            : unsupportedFilters.length > 0
              ? `Unsupported placed-layer filters: ${unsupportedFilters.join(', ')}.`
              : undefined;
  return {
    layerIndex,
    sourceId: typeof placedLayer.id === 'string' ? placedLayer.id : null,
    source,
    placement,
    filters: mapped,
    unsupportedFilters,
    previewOnly: duplicateLinkedFile || !source || !placement || unsupportedFilters.length > 0,
    ...(reason ? { reason } : {}),
  };
}

function validateSource(source: SmartObjectPsdSourceRecord): void {
  if (!source.id.trim()) throw new Error('Smart Object source id is required.');
  if (!source.name.trim()) throw new Error('Smart Object source name is required.');
  if (!source.mimeType.trim()) throw new Error('Smart Object source MIME type is required.');
  if (source.bytes.byteLength === 0) throw new Error('Smart Object source bytes must not be empty.');
  if (source.bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Smart Object source exceeds the ${MAX_SOURCE_BYTES / (1024 * 1024)} MiB limit.`);
  }
}

function validatePlacement(placement: SmartObjectPsdPlacement): SmartObjectPsdPlacement {
  if (placement.transform.length !== PLACEMENT_NUMBER_COUNT || placement.transform.some((value) => !Number.isFinite(value))) {
    throw new Error('Smart Object placement requires eight finite transform coordinates.');
  }
  if (!Number.isFinite(placement.width) || !Number.isFinite(placement.height)
    || placement.width <= 0 || placement.height <= 0) {
    throw new Error('Smart Object placement dimensions must be positive finite numbers.');
  }
  return {
    transform: [...placement.transform],
    width: Math.max(1, Math.round(placement.width)),
    height: Math.max(1, Math.round(placement.height)),
  };
}

function tryValidatePlacement(placement: Partial<PlacedLayer>): SmartObjectPsdPlacement | null {
  try {
    return validatePlacement({
      transform: placement.transform ?? [],
      width: placement.width ?? 0,
      height: placement.height ?? 0,
    });
  } catch {
    return null;
  }
}

function normalizeFilters(filters: readonly SmartObjectPsdFilterRecord[]): PsdFilter[] {
  return filters.map((filter) => {
    if (!Number.isFinite(filter.radius) || filter.radius < 0 || filter.radius > 10000) {
      throw new Error('Smart Object filter radius must be finite and between 0 and 10000.');
    }
    const common = {
      name: filter.kind === 'gaussian-blur' ? 'Gaussian Blur' : 'Box Blur',
      opacity: 1,
      blendMode: 'normal' as const,
      enabled: filter.enabled !== false,
      hasOptions: true,
      foregroundColor: { r: 0, g: 0, b: 0 },
      backgroundColor: { r: 255, g: 255, b: 255 },
    };
    return filter.kind === 'gaussian-blur'
      ? { ...common, type: 'gaussian blur' as const, filter: { radius: { value: filter.radius, units: 'Pixels' as const } } }
      : { ...common, type: 'box blur' as const, filter: { radius: { value: filter.radius, units: 'Pixels' as const } } };
  });
}

function isSupportedPsdFilter(filter: PsdFilter): boolean {
  return filter.type === 'gaussian blur' || filter.type === 'box blur';
}

function mapPsdFilter(filter: PsdFilter): SmartObjectPsdFilterRecord[] {
  if (filter.type === 'gaussian blur' || filter.type === 'box blur') {
    return [{
      kind: filter.type === 'gaussian blur' ? 'gaussian-blur' : 'box-blur',
      radius: filter.filter.radius.value,
      enabled: filter.enabled,
    }];
  }
  return [];
}

function normalizeGuid(value: string): string {
  const compact = value.replace(/[^a-f0-9]/gi, '').toLowerCase().padEnd(32, '0').slice(0, 32);
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function inferMimeType(type: string | undefined, bytes: Uint8Array): string {
  if (type && type !== 'imag' && type.includes('/')) return type;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) return 'image/tiff';
  return type || 'application/octet-stream';
}

function byteArraysEqual(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
