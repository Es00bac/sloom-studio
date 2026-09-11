import type {
  ImageDocument,
  ImageDocumentSnapshot,
  ImageDocumentSnapshotAssetIntegrity,
  ImageDocumentSnapshotIntegrity,
  ImageLayer,
  LayerBitmap,
  SelectionMaskSnapshot,
} from '../../types/imageEditor';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  cloneBitmap,
  getBitmapImageData,
  isBitmapImmutable,
  makeBitmapImmutable,
  releaseImmutableBitmap,
  UnsupportedLayerBitmapPlatformError,
} from './LayerBitmap';
import { fromSnapshot, toSnapshot, type SelectionMask } from './SelectionMask';
import { clearSelection, getSelection, setSelection } from './selectionRegistry';
import {
  decodeImageTiltmarkSimulation,
  MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH,
} from './tiltmark/ImageTiltmarkLayer';

export const IMAGE_DOCUMENT_MAX_SNAPSHOTS = 12;
export const IMAGE_PROJECT_MAX_SNAPSHOTS = 96;
export const IMAGE_SNAPSHOT_MAX_DIMENSION = 16_384;
export const IMAGE_SNAPSHOT_MAX_LAYERS = 2_048;
export const IMAGE_DOCUMENT_MAX_SNAPSHOT_LAYERS = 8_192;
export const IMAGE_PROJECT_MAX_SNAPSHOT_LAYERS = 65_536;
export const IMAGE_SNAPSHOT_MAX_STRUCTURAL_RESOURCES = IMAGE_SNAPSHOT_MAX_LAYERS * 6 + 2;
export const IMAGE_DOCUMENT_MAX_SNAPSHOT_STRUCTURAL_RESOURCES = (
  IMAGE_DOCUMENT_MAX_SNAPSHOT_LAYERS * 6 + IMAGE_DOCUMENT_MAX_SNAPSHOTS * 2
);
export const IMAGE_PROJECT_MAX_SNAPSHOT_STRUCTURAL_RESOURCES = (
  IMAGE_PROJECT_MAX_SNAPSHOT_LAYERS * 6 + IMAGE_PROJECT_MAX_SNAPSHOTS * 2
);
export const IMAGE_SNAPSHOT_MAX_METADATA_BYTES = 16 * 1024 * 1024;
export const IMAGE_DOCUMENT_MAX_SNAPSHOT_METADATA_BYTES = 64 * 1024 * 1024;
export const IMAGE_PROJECT_MAX_SNAPSHOT_METADATA_BYTES = 512 * 1024 * 1024;
export const IMAGE_SNAPSHOT_MAX_AGGREGATE_BYTES = 768 * 1024 * 1024;
export const IMAGE_SNAPSHOT_MAX_METADATA_DEPTH = 256;

export type ImageSnapshotReadinessIssueCode =
  | 'invalid-snapshot-dimensions'
  | 'empty-snapshot-layers'
  | 'missing-snapshot'
  | 'blank-snapshot-name'
  | 'unchanged-snapshot-name'
  | 'snapshot-limit-reached'
  | 'snapshot-pixels-unavailable'
  | 'snapshot-integrity-unproven'
  | 'snapshot-selection-unavailable';

export interface ImageSnapshotReadinessIssue {
  code: ImageSnapshotReadinessIssueCode;
  severity: 'error' | 'warning';
  snapshotId?: string;
  message: string;
}

export interface ImageNamedSnapshotReadiness {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number | null;
  width: number;
  height: number;
  layerCount: number;
  activeLayerId: string | null;
  hasSelection: boolean;
  selectionVersion: number;
  restorable: boolean;
  blockers: ImageSnapshotReadinessIssue[];
  warnings: ImageSnapshotReadinessIssue[];
  previewSignature: string;
}

export interface ImageSnapshotRenameReadiness {
  supported: boolean;
  targetSnapshotId: string | null;
  targetExists: boolean;
  currentName: string | null;
  draftName: string;
  unchanged: boolean;
  willUpdate: boolean;
  blockers: ImageSnapshotReadinessIssue[];
  warnings: ImageSnapshotReadinessIssue[];
  signature: string;
}

export interface ImageSnapshotReadinessDescriptor {
  descriptorId: 'image-history-snapshots-readiness:v1';
  document: {
    id: string;
    title: string;
    width: number;
    height: number;
    layerCount: number;
    activeLayerId: string | null;
    hasSelection: boolean;
    dirty: boolean;
  };
  capacity: {
    maxSnapshots: typeof IMAGE_DOCUMENT_MAX_SNAPSHOTS;
    count: number;
    remaining: number;
    canCreate: boolean;
  };
  namedSnapshots: {
    count: number;
    hasNamedSnapshots: boolean;
    snapshots: ImageNamedSnapshotReadiness[];
    signature: string;
  };
  rename: ImageSnapshotRenameReadiness;
  automationMetadata: {
    workspaceId: 'image-automation';
    separateFromMainFlow: true;
    bindingReadiness: 'ready-for-review';
    supportsNamedSnapshotVariables: true;
    supportsArbitraryJsExpressions: false;
    snapshotVariableTargets: string[];
  };
  blockers: ImageSnapshotReadinessIssue[];
  warnings: ImageSnapshotReadinessIssue[];
  preview: {
    id: string;
    signature: string;
  };
}

const ownedNamedSnapshots = new WeakSet<ImageDocumentSnapshot>();
const verifiedNamedSnapshots = new WeakMap<ImageDocumentSnapshot, VerifiedSnapshotBinding>();
const immutableSelectionBytes = new WeakMap<SelectionMaskSnapshot, { bytes: Uint8ClampedArray }>();
const supersededOwnedBitmaps = new WeakMap<ImageDocumentSnapshot, Set<LayerBitmap>>();

interface VerifiedSnapshotLayerBinding {
  layer: ImageLayer;
  id: string;
  bitmap: LayerBitmap | null;
  bitmapWidth: number;
  bitmapHeight: number;
  bitmapMetadataSignature: string;
  bitmapMetadataSymbols: readonly symbol[];
  mask: LayerBitmap | null;
  maskWidth: number;
  maskHeight: number;
  maskMetadataSignature: string;
  maskMetadataSymbols: readonly symbol[];
  tiltmarkBaseBitmap: LayerBitmap | null;
  tiltmarkBaseWidth: number;
  tiltmarkBaseHeight: number;
  tiltmarkBaseMetadataSignature: string;
  tiltmarkBaseMetadataSymbols: readonly symbol[];
  tiltmarkSimulationData: string | null | undefined;
  proof: ImageDocumentSnapshotIntegrity['layers'][number];
  proofLayerId: string;
  bitmapProof: ImageDocumentSnapshotAssetIntegrity;
  bitmapProofSignature: string;
  maskProof: ImageDocumentSnapshotAssetIntegrity;
  maskProofSignature: string;
  tiltmarkBaseProof: ImageDocumentSnapshotAssetIntegrity | undefined;
  tiltmarkBaseProofSignature: string;
  tiltmarkSimulationProofSignature: string;
}

interface VerifiedSnapshotBinding {
  layers: ImageDocumentSnapshot['layers'];
  integrity: ImageDocumentSnapshotIntegrity;
  proofLayers: ImageDocumentSnapshotIntegrity['layers'];
  selectionProof: ImageDocumentSnapshotIntegrity['selection'];
  selectionProofSignature: string;
  selectionMask: SelectionMaskSnapshot | undefined;
  selectionBytes: Uint8ClampedArray | undefined;
  snapshotSignature: string;
  layerBindings: VerifiedSnapshotLayerBinding[];
  result: ImageDocumentSnapshotIntegrityResult;
}

type SnapshotAssetRole =
  | 'bitmap-rgba8'
  | 'mask-rgba8'
  | 'tiltmark-base-rgba8'
  | 'tiltmark-simulation-gzip-json'
  | 'selection-alpha8';

type UnknownRecord = Record<string, unknown>;
type UnknownPropertyRecord = Record<PropertyKey, unknown>;

interface EnumerableOwnEntry {
  key: PropertyKey;
  descriptor: PropertyDescriptor & { enumerable: true };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function nonemptyIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function enumerableOwnEntries(value: object): EnumerableOwnEntry[] {
  const entries: EnumerableOwnEntry[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new Error('Image snapshot metadata descriptor is not safely readable.');
    if (descriptor.enumerable) {
      entries.push({ key, descriptor: descriptor as EnumerableOwnEntry['descriptor'] });
    }
  }
  return entries;
}

function metadataKeyToken(key: PropertyKey): string {
  if (typeof key === 'string') return `string-key:${key.length}:${key}`;
  if (typeof key === 'number') return `number-key:${String(key)}`;
  const globalKey = Symbol.keyFor(key);
  const description = key.description ?? '';
  return `symbol-key:global:${globalKey === undefined ? -1 : globalKey.length}:${globalKey ?? ''}:description:${description.length}:${description}`;
}

function metadataKeyByteLengthAtMost(key: PropertyKey, maximum: number): number {
  return jsonStringByteLengthAtMost(
    typeof key === 'string' ? key : metadataKeyToken(key),
    maximum,
  );
}

/**
 * Reject hostile project/native snapshot graphs before any bitmap decode,
 * canvas allocation, selection allocation, or pixel hashing begins.
 */
export function assertImageDocumentSnapshotDecodeBounds(
  snapshots: readonly unknown[],
  options: {
    transport?: 'project' | 'native' | 'runtime';
    maxSnapshots?: number;
    maxAggregateBytes?: number;
    maxAggregateLayers?: number;
    maxAggregateProofs?: number;
    maxAggregateResources?: number;
    maxSnapshotMetadataBytes?: number;
    maxAggregateMetadataBytes?: number;
    requireResourceOwnFieldCoverage?: boolean;
  } = {},
): void {
  const maxSnapshots = options.maxSnapshots ?? IMAGE_DOCUMENT_MAX_SNAPSHOTS;
  const maxAggregateBytes = options.maxAggregateBytes ?? IMAGE_SNAPSHOT_MAX_AGGREGATE_BYTES;
  const maxAggregateLayers = options.maxAggregateLayers ?? IMAGE_DOCUMENT_MAX_SNAPSHOT_LAYERS;
  const maxAggregateProofs = options.maxAggregateProofs ?? IMAGE_DOCUMENT_MAX_SNAPSHOT_LAYERS;
  const maxAggregateResources = options.maxAggregateResources
    ?? IMAGE_DOCUMENT_MAX_SNAPSHOT_STRUCTURAL_RESOURCES;
  const maxSnapshotMetadataBytes = options.maxSnapshotMetadataBytes ?? IMAGE_SNAPSHOT_MAX_METADATA_BYTES;
  const maxAggregateMetadataBytes = options.maxAggregateMetadataBytes
    ?? IMAGE_DOCUMENT_MAX_SNAPSHOT_METADATA_BYTES;
  if (snapshots.length > maxSnapshots) {
    throw new Error(`Image snapshot count exceeds ${maxSnapshots}.`);
  }
  let aggregateBytes = 0;
  let aggregateLayers = 0;
  let aggregateProofs = 0;
  let aggregateResources = 0;
  let aggregateMetadataBytes = 0;
  for (const [snapshotIndex, candidate] of snapshots.entries()) {
    if (!isRecord(candidate)) {
      throw new Error(`Image snapshot ${snapshotIndex} is malformed.`);
    }
    if (!Array.isArray(candidate.layers)) {
      throw new Error(`Image snapshot ${snapshotIndex} layer graph is malformed.`);
    }
    const layers = candidate.layers;
    if (layers.length > IMAGE_SNAPSHOT_MAX_LAYERS) {
      throw new Error(`Image snapshot ${snapshotIndex} layer count exceeds ${IMAGE_SNAPSHOT_MAX_LAYERS}.`);
    }
    aggregateLayers = addBoundedStructuralCount(
      aggregateLayers,
      layers.length,
      maxAggregateLayers,
      'layer count',
    );
    assertBoundedDimension(candidate.width, `snapshot ${snapshotIndex} width`);
    assertBoundedDimension(candidate.height, `snapshot ${snapshotIndex} height`);

    const integrity = candidate.integrity;
    const proofs = isRecord(integrity) && Array.isArray(integrity.layers) ? integrity.layers : [];
    if (proofs.length > IMAGE_SNAPSHOT_MAX_LAYERS) {
      throw new Error(`Image snapshot ${snapshotIndex} proof count exceeds ${IMAGE_SNAPSHOT_MAX_LAYERS}.`);
    }
    aggregateProofs = addBoundedStructuralCount(
      aggregateProofs,
      proofs.length,
      maxAggregateProofs,
      'proof count',
    );
    const snapshotResources = countRawSnapshotStructuralResources(candidate, layers, proofs);
    if (snapshotResources > IMAGE_SNAPSHOT_MAX_STRUCTURAL_RESOURCES) {
      throw new Error(
        `Image snapshot ${snapshotIndex} structural resource count exceeds ${IMAGE_SNAPSHOT_MAX_STRUCTURAL_RESOURCES}.`,
      );
    }
    aggregateResources = addBoundedStructuralCount(
      aggregateResources,
      snapshotResources,
      maxAggregateResources,
      'structural resource count',
    );
    const metadataBytes = measureRawSnapshotMetadataBytes(
      candidate,
      options.transport ?? 'runtime',
      maxSnapshotMetadataBytes,
      options.requireResourceOwnFieldCoverage ?? false,
    );
    if (metadataBytes > maxSnapshotMetadataBytes) {
      throw new Error(`Image snapshot ${snapshotIndex} metadata exceeds ${maxSnapshotMetadataBytes} bytes.`);
    }
    aggregateMetadataBytes = addBoundedStructuralCount(
      aggregateMetadataBytes,
      metadataBytes,
      maxAggregateMetadataBytes,
      'metadata',
      'bytes',
    );

    if (candidate.pixelState !== 'complete' || !isRecord(integrity) || integrity.version !== 2) continue;
    if (!Array.isArray(integrity.layers)) {
      throw new Error(`Image snapshot ${snapshotIndex} has no current integrity manifest.`);
    }
    const identityReasons = inspectRawSnapshotLayerIdentity(layers, integrity.layers);
    if (identityReasons.length > 0) {
      throw new Error(`Image snapshot ${snapshotIndex} layer identity proof is invalid: ${identityReasons.join(', ')}.`);
    }
    const proofById = new Map(integrity.layers.flatMap((proof) => (
      isRecord(proof) && typeof proof.layerId === 'string' ? [[proof.layerId, proof] as const] : []
    )));
    if (options.transport === 'native' || options.transport === 'project') {
      for (const rawLayer of layers) {
        const layer = rawLayer as UnknownRecord;
        const proof = proofById.get(layer.id as string)!;
        assertTransportAssetMatchesProof(layer, proof, 'bitmap', options.transport, snapshotIndex);
        assertTransportAssetMatchesProof(layer, proof, 'mask', options.transport, snapshotIndex);
        if (
          proof.tiltmarkBase !== undefined
          || (layer.tiltmarkBaseBitmap !== undefined && layer.tiltmarkBaseBitmap !== null)
          || (layer.tiltmarkBaseBitmapData !== undefined && layer.tiltmarkBaseBitmapData !== null)
        ) {
          assertTransportAssetMatchesProof(
            layer,
            proof,
            'tiltmarkBaseBitmap',
            options.transport,
            snapshotIndex,
          );
        }
        assertTransportTiltmarkStateMatchesProof(
          layer,
          proof,
          options.transport,
          snapshotIndex,
        );
      }
    }
    for (const [proofIndex, proof] of integrity.layers.entries()) {
      if (!isRecord(proof)) throw new Error(`Image snapshot ${snapshotIndex} proof ${proofIndex} is malformed.`);
      aggregateBytes = addBoundedAssetBytes(
        aggregateBytes,
        proof.bitmap,
        4,
        `snapshot ${snapshotIndex} bitmap proof ${proofIndex}`,
        maxAggregateBytes,
      );
      if (proof.tiltmarkBase !== undefined) {
        aggregateBytes = addBoundedAssetBytes(
          aggregateBytes,
          proof.tiltmarkBase,
          4,
          `snapshot ${snapshotIndex} Tiltmark base proof ${proofIndex}`,
          maxAggregateBytes,
        );
      }
      if (proof.tiltmarkSimulation !== undefined) {
        if (!validTiltmarkSimulationProofShape(proof.tiltmarkSimulation)) {
          throw new Error(`Image snapshot ${snapshotIndex} Tiltmark simulation proof ${proofIndex} is malformed.`);
        }
        aggregateBytes = addAggregateBytes(
          aggregateBytes,
          Number(proof.tiltmarkSimulation.byteLength),
          maxAggregateBytes,
        );
      }
      aggregateBytes = addBoundedAssetBytes(
        aggregateBytes,
        proof.mask,
        4,
        `snapshot ${snapshotIndex} mask proof ${proofIndex}`,
        maxAggregateBytes,
      );
    }
    if (!isRecord(integrity.selection) || typeof integrity.selection.present !== 'boolean') {
      throw new Error(`Image snapshot ${snapshotIndex} selection proof is malformed.`);
    }
    if (integrity.selection.present) {
      const width = assertBoundedDimension(integrity.selection.width, `snapshot ${snapshotIndex} selection width`);
      const height = assertBoundedDimension(integrity.selection.height, `snapshot ${snapshotIndex} selection height`);
      const bytes = safePixelByteLength(width, height, 1, `snapshot ${snapshotIndex} selection`);
      if (integrity.selection.byteLength !== bytes) {
        throw new Error(`Image snapshot ${snapshotIndex} selection byte length is inconsistent.`);
      }
      if (!/^sha256:[a-f0-9]{64}$/.test(String(integrity.selection.contentDigest ?? ''))) {
        throw new Error(`Image snapshot ${snapshotIndex} has a malformed cryptographic content integrity selection digest.`);
      }
      if (options.transport === 'project' && typeof candidate.selectionMaskData !== 'string') {
        throw new Error(`Image snapshot ${snapshotIndex} selection payload is missing from its integrity proof.`);
      }
      if (options.transport === 'native') {
        assertNativeAssetRef(candidate.selectionMask, width, height, `snapshot ${snapshotIndex} selection`);
      }
      aggregateBytes = addAggregateBytes(aggregateBytes, bytes, maxAggregateBytes);
    } else if (
      integrity.selection.width !== 0
      || integrity.selection.height !== 0
      || integrity.selection.byteLength !== 0
      || integrity.selection.contentDigest !== undefined
    ) {
      throw new Error(`Image snapshot ${snapshotIndex} absent selection proof is nonempty.`);
    } else if (
      (options.transport === 'project' && candidate.selectionMaskData !== undefined)
      || (options.transport === 'native' && candidate.selectionMask !== null && candidate.selectionMask !== undefined)
    ) {
      throw new Error(`Image snapshot ${snapshotIndex} has an unexpected selection payload outside its integrity proof.`);
    }
  }
}

function addBoundedStructuralCount(
  total: number,
  amount: number,
  maximum: number,
  label: string,
  unit = '',
): number {
  const next = total + amount;
  if (!Number.isSafeInteger(next) || next > maximum) {
    throw new Error(`Image snapshot aggregate ${label} exceeds ${maximum}${unit ? ` ${unit}` : ''}.`);
  }
  return next;
}

function countRawSnapshotStructuralResources(
  snapshot: UnknownRecord,
  layers: readonly unknown[],
  proofs: readonly unknown[],
): number {
  let resources = 0;
  const countPresent = (record: UnknownRecord, keys: readonly string[]) => {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) resources += 1;
    }
  };
  for (const layer of layers) {
    if (isRecord(layer)) {
      countPresent(layer, [
        'bitmap',
        'mask',
        'bitmapData',
        'maskData',
        'tiltmarkBaseBitmap',
        'tiltmarkBaseBitmapData',
        'tiltmarkSimulationData',
      ]);
    }
  }
  for (const proof of proofs) {
    if (isRecord(proof)) {
      countPresent(proof, ['bitmap', 'mask', 'tiltmarkBase', 'tiltmarkSimulation']);
    }
  }
  countPresent(snapshot, ['selectionMask', 'selectionMaskData']);
  if (isRecord(snapshot.integrity) && snapshot.integrity.selection !== undefined && snapshot.integrity.selection !== null) {
    resources += 1;
  }
  return resources;
}

type MetadataTraversalKind =
  | 'snapshot'
  | 'layer-array'
  | 'layer'
  | 'bitmap-resource'
  | 'bitmap-metadata'
  | 'generic';

function measureRawSnapshotMetadataBytes(
  snapshot: UnknownRecord,
  transport: 'project' | 'native' | 'runtime',
  maximum: number,
  requireResourceOwnFieldCoverage: boolean,
): number {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; kind: MetadataTraversalKind; depth: number }> = [
    { value: snapshot, kind: 'snapshot', depth: 0 },
  ];
  let bytes = 0;
  const add = (amount: number) => {
    bytes += amount;
    return bytes > maximum;
  };

  while (stack.length > 0 && bytes <= maximum) {
    const { value, kind, depth } = stack.pop()!;
    if (depth > IMAGE_SNAPSHOT_MAX_METADATA_DEPTH) {
      throw new Error(`Image snapshot metadata depth exceeds ${IMAGE_SNAPSHOT_MAX_METADATA_DEPTH}.`);
    }
    if (value === null) {
      add(4);
      continue;
    }
    if (typeof value === 'string') {
      add(jsonStringByteLengthAtMost(value, maximum - bytes));
      continue;
    }
    if (typeof value === 'number') {
      add(Number.isFinite(value) ? String(value).length : 4);
      continue;
    }
    if (typeof value === 'boolean') {
      add(value ? 4 : 5);
      continue;
    }
    if (typeof value === 'bigint') {
      add(String(value).length);
      continue;
    }
    if (typeof value === 'function') {
      if (kind === 'bitmap-resource' || kind === 'bitmap-metadata') {
        throw new Error('Image snapshot callable metadata is unsupported and cannot enter snapshot ownership.');
      }
      continue;
    }
    if (value === undefined || typeof value === 'symbol') continue;
    if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
      const pixelBytes = exactBinaryBytes(value.data);
      add(Math.min(maximum + 1, pixelBytes.byteLength + 24));
      continue;
    }
    if (ArrayBuffer.isView(value)) {
      const bytes = exactBinaryBytes(value);
      add(Math.min(maximum + 1, bytes.byteLength + 2));
      continue;
    }
    if (value instanceof ArrayBuffer) {
      const bytes = exactBinaryBytes(value);
      add(Math.min(maximum + 1, bytes.byteLength + 2));
      continue;
    }
    if (typeof value !== 'object') continue;
    if (seen.has(value)) {
      add(4);
      continue;
    }
    seen.add(value);
    const bitmapMetadata = kind === 'bitmap-resource' || kind === 'bitmap-metadata';
    if (bitmapMetadata && requireResourceOwnFieldCoverage && Object.isExtensible(value)) {
      throw new Error('Image snapshot bitmap metadata own-field coverage is not controlled.');
    }
    if (Array.isArray(value) && !bitmapMetadata) {
      if (add(2 + Math.max(0, value.length - 1))) continue;
      const childKind: MetadataTraversalKind = kind === 'layer-array' ? 'layer' : 'generic';
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], kind: childKind, depth: depth + 1 });
      }
      continue;
    }
    if (Array.isArray(value) && add(2 + Math.max(0, value.length - 1))) continue;

    const record = value as UnknownPropertyRecord;
    const entries = enumerableOwnEntries(record);
    if (add(2 + Math.max(0, entries.length - 1))) continue;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const { key, descriptor } = entries[index];
      if (add(metadataKeyByteLengthAtMost(key, maximum - bytes) + 1)) break;
      if (bitmapMetadata && !('value' in descriptor)) {
        if (kind === 'bitmap-resource' && isImmutableBitmapDimensionDescriptor(record, key)) continue;
        throw new Error('Image snapshot bitmap metadata descriptor is not safely readable.');
      }
      if (shouldSkipSnapshotPixelMetadataValue(kind, key, descriptor?.value, transport)) continue;
      stack.push({
        value: 'value' in descriptor ? descriptor.value : record[key],
        kind: kind === 'snapshot' && key === 'layers'
          ? 'layer-array'
          : kind === 'layer' && transport !== 'native'
            && (key === 'bitmap' || key === 'mask' || key === 'tiltmarkBaseBitmap')
            ? 'bitmap-resource'
            : bitmapMetadata
              ? 'bitmap-metadata'
              : 'generic',
        depth: depth + 1,
      });
    }
  }
  return bytes;
}

function shouldSkipSnapshotPixelMetadataValue(
  kind: MetadataTraversalKind,
  key: PropertyKey,
  _value: unknown,
  transport: 'project' | 'native' | 'runtime',
): boolean {
  if (typeof key !== 'string') return false;
  if (kind === 'layer' && (
    key === 'bitmapData'
    || key === 'maskData'
    || key === 'tiltmarkBaseBitmapData'
    || key === 'tiltmarkSimulationData'
  )) return true;
  if (kind === 'snapshot' && key === 'selectionMaskData') return true;
  if (transport === 'native') return false;
  return kind === 'snapshot' && key === 'selectionMask';
}

function exactBinaryBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  const buffer = value instanceof ArrayBuffer ? value : value.buffer;
  if (buffer instanceof ArrayBuffer) buffer.slice(0, 0);
  const byteOffset = value instanceof ArrayBuffer ? 0 : value.byteOffset;
  const byteLength = value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
  return new Uint8Array(buffer, byteOffset, byteLength);
}

function isImmutableBitmapDimensionDescriptor(record: UnknownPropertyRecord, key: PropertyKey): boolean {
  return typeof key === 'string' && (key === 'width' || key === 'height')
    && isBitmapImmutable(record as unknown as LayerBitmap);
}

/**
 * Make every enumerable non-pixel object reachable from a bitmap resource
 * non-extensible. Once a Proxy target is non-extensible, the language's
 * ownKeys invariants make hidden own fields observable as a trap failure.
 */
function controlBitmapMetadataOwnFields(bitmap: LayerBitmap): void {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; resourceRoot: boolean; depth: number }> = [
    { value: bitmap, resourceRoot: true, depth: 0 },
  ];
  while (stack.length > 0) {
    const { value, resourceRoot, depth } = stack.pop()!;
    if (depth > IMAGE_SNAPSHOT_MAX_METADATA_DEPTH) {
      throw new Error(`Image snapshot bitmap metadata depth exceeds ${IMAGE_SNAPSHOT_MAX_METADATA_DEPTH}.`);
    }
    if (typeof value === 'function') {
      throw new Error('Image snapshot callable metadata is unsupported and cannot enter snapshot ownership.');
    }
    if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      continue;
    }
    if (typeof ImageData !== 'undefined' && value instanceof ImageData) continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (Object.isExtensible(value)) Object.preventExtensions(value);
    if (Object.isExtensible(value)) {
      throw new Error('Image snapshot bitmap metadata own-field coverage could not be controlled.');
    }
    const record = value as UnknownPropertyRecord;
    const entries = enumerableOwnEntries(record);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const { key, descriptor } = entries[index];
      if (!('value' in descriptor)) {
        if (resourceRoot && isImmutableBitmapDimensionDescriptor(record, key)) continue;
        throw new Error('Image snapshot bitmap metadata descriptor is not safely readable.');
      }
      stack.push({ value: descriptor.value, resourceRoot: false, depth: depth + 1 });
    }
  }
}

interface SnapshotResourceReplacement {
  layer: ImageLayer;
  role: 'bitmap' | 'mask' | 'tiltmarkBaseBitmap';
  original: LayerBitmap;
  replacement: LayerBitmap;
}

interface PreparedSnapshotResourceCoverage {
  commit: () => void;
  rollback: () => void;
  finalize: () => void;
}

function cloneMetadataValue(
  value: unknown,
  clones: Map<object, unknown>,
  depth: number,
): unknown {
  if (depth > IMAGE_SNAPSHOT_MAX_METADATA_DEPTH) {
    throw new Error(`Image snapshot bitmap metadata depth exceeds ${IMAGE_SNAPSHOT_MAX_METADATA_DEPTH}.`);
  }
  if (typeof value === 'function') {
    throw new Error('Image snapshot callable metadata is unsupported and cannot enter snapshot ownership.');
  }
  if (value === null || typeof value !== 'object') return value;
  const existing = clones.get(value as object);
  if (existing !== undefined) return existing;
  if (ArrayBuffer.isView(value)) {
    exactBinaryBytes(value);
    const cloned = structuredClone(value);
    clones.set(value, cloned);
    return cloned;
  }
  if (value instanceof ArrayBuffer) {
    exactBinaryBytes(value);
    const cloned = value.slice(0);
    clones.set(value, cloned);
    return cloned;
  }
  if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
    const cloned = new ImageData(new Uint8ClampedArray(value.data), value.width, value.height, {
      colorSpace: value.colorSpace,
    });
    clones.set(value, cloned);
    return cloned;
  }
  const entries = enumerableOwnEntries(value);
  const clone: UnknownPropertyRecord | unknown[] = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(null) as UnknownPropertyRecord;
  clones.set(value, clone);
  for (const { key, descriptor } of entries) {
    if (!('value' in descriptor)) {
      throw new Error('Image snapshot bitmap metadata accessor cannot enter verified state.');
    }
    Object.defineProperty(clone, key, {
      ...descriptor,
      value: cloneMetadataValue(descriptor.value, clones, depth + 1),
    });
  }
  return clone;
}

function isCanonicalBitmapDimension(
  bitmap: LayerBitmap,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): boolean {
  if (key !== 'width' && key !== 'height') return false;
  if ('value' in descriptor) return descriptor.value === bitmap[key];
  return isBitmapImmutable(bitmap);
}

function copyBitmapEnumerableMetadata(
  source: LayerBitmap,
  destination: LayerBitmap,
  clones: Map<object, unknown>,
): void {
  clones.set(source, destination);
  for (const { key, descriptor } of enumerableOwnEntries(source)) {
    if (isCanonicalBitmapDimension(source, key, descriptor)) continue;
    if (!('value' in descriptor)) {
      throw new Error('Image snapshot bitmap metadata accessor cannot enter verified state.');
    }
    const existing = Object.getOwnPropertyDescriptor(destination, key);
    if (existing && !existing.configurable) {
      throw new Error('Image snapshot bitmap metadata conflicts with its immutable pixel clone.');
    }
    Object.defineProperty(destination, key, {
      ...descriptor,
      value: cloneMetadataValue(descriptor.value, clones, 1),
    });
  }
}

function disposePreparedBitmap(bitmap: LayerBitmap): void {
  releaseImmutableBitmap(bitmap);
  try {
    bitmap.width = 0;
    bitmap.height = 0;
  } catch {
    // A failed fresh clone is unreachable after rollback; native reclamation remains platform-managed.
  }
}

/**
 * Build and harden a detached retained-resource graph before changing the
 * snapshot. Proxy traps and descriptor failures can only affect fresh clones;
 * rollback restores every resource identity before those clones are released.
 */
function prepareSnapshotResourceCoverage(
  snapshot: ImageDocumentSnapshot,
  reuseControlledResources = false,
): PreparedSnapshotResourceCoverage {
  const replacements: SnapshotResourceReplacement[] = [];
  const clonedBitmaps = new Map<LayerBitmap, LayerBitmap>();
  const metadataClones = new Map<object, unknown>();
  const freshClones: LayerBitmap[] = [];
  let committed = false;
  let finalized = false;
  try {
    for (const layer of snapshot.layers) {
      for (const role of ['bitmap', 'mask', 'tiltmarkBaseBitmap'] as const) {
        const original = layer[role];
        if (!original || reuseControlledResources) continue;
        let replacement = clonedBitmaps.get(original);
        if (!replacement) {
          replacement = cloneBitmap(original);
          clonedBitmaps.set(original, replacement);
          metadataClones.set(original, replacement);
          freshClones.push(replacement);
        }
        replacements.push({ layer, role, original, replacement });
      }
    }
    for (const [source, destination] of clonedBitmaps) {
      copyBitmapEnumerableMetadata(source, destination, metadataClones);
    }
    for (const bitmap of freshClones) {
      makeBitmapImmutable(bitmap);
      controlBitmapMetadataOwnFields(bitmap);
    }
  } catch (error) {
    for (const bitmap of freshClones.reverse()) disposePreparedBitmap(bitmap);
    if (error instanceof UnsupportedLayerBitmapPlatformError) throw error;
    throw new Error('Image snapshot resource own-field coverage could not be controlled.', { cause: error });
  }

  const rollback = () => {
    if (finalized) return;
    if (committed) {
      for (const replacement of replacements) replacement.layer[replacement.role] = replacement.original;
      committed = false;
    }
    for (const bitmap of freshClones.splice(0).reverse()) disposePreparedBitmap(bitmap);
  };
  return {
    commit: () => {
      if (committed || finalized) return;
      let applied = 0;
      try {
        for (const replacement of replacements) {
          replacement.layer[replacement.role] = replacement.replacement;
          applied += 1;
        }
        committed = true;
      } catch (error) {
        for (let index = applied - 1; index >= 0; index -= 1) {
          const replacement = replacements[index];
          replacement.layer[replacement.role] = replacement.original;
        }
        for (const bitmap of freshClones.splice(0).reverse()) disposePreparedBitmap(bitmap);
        throw error;
      }
    },
    rollback,
    finalize: () => {
      if (!committed || finalized) return;
      const superseded = supersededOwnedBitmaps.get(snapshot) ?? new Set<LayerBitmap>();
      for (const { original } of replacements) superseded.add(original);
      if (superseded.size > 0) supersededOwnedBitmaps.set(snapshot, superseded);
      finalized = true;
    },
  };
}

function jsonStringByteLengthAtMost(value: string, maximum: number): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) bytes += 2;
    else if (code <= 0x1f) bytes += 6;
    else if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
    if (bytes > maximum) return maximum + 1;
  }
  return bytes;
}

function assertTransportAssetMatchesProof(
  layer: UnknownRecord,
  proof: UnknownRecord,
  role: 'bitmap' | 'mask' | 'tiltmarkBaseBitmap',
  transport: 'project' | 'native',
  snapshotIndex: number,
): void {
  const proofRole = role === 'tiltmarkBaseBitmap' ? 'tiltmarkBase' : role;
  const assetProof = proof[proofRole];
  if (!isRecord(assetProof) || typeof assetProof.present !== 'boolean') {
    throw new Error(`Image snapshot ${snapshotIndex} ${role} proof is malformed.`);
  }
  if (transport === 'project') {
    const payload = layer[`${role}Data`];
    if (assetProof.present !== (typeof payload === 'string')) {
      throw new Error(`Image snapshot ${snapshotIndex} ${role} payload presence is inconsistent with its integrity proof.`);
    }
    return;
  }
  if (!assetProof.present) {
    if (layer[role] !== null && layer[role] !== undefined) {
      throw new Error(`Image snapshot ${snapshotIndex} has an unexpected native ${role} payload.`);
    }
    return;
  }
  assertNativeAssetRef(
    layer[role],
    assetProof.width as number,
    assetProof.height as number,
    `snapshot ${snapshotIndex} ${role}`,
  );
}

function assertTransportTiltmarkStateMatchesProof(
  layer: UnknownRecord,
  proof: UnknownRecord,
  transport: 'project' | 'native',
  snapshotIndex: number,
): void {
  const stateProof = proof.tiltmarkSimulation;
  const payload = layer.tiltmarkSimulationData;
  if (stateProof === undefined && (payload === undefined || payload === null)) return;
  if (!validTiltmarkSimulationProofShape(stateProof)) {
    throw new Error(`Image snapshot ${snapshotIndex} Tiltmark simulation proof is malformed.`);
  }
  if (transport === 'project') {
    if (stateProof.present !== (typeof payload === 'string')) {
      throw new Error(`Image snapshot ${snapshotIndex} Tiltmark simulation payload presence is inconsistent with its integrity proof.`);
    }
    if (typeof payload === 'string'
      && new TextEncoder().encode(payload).byteLength !== stateProof.byteLength) {
      throw new Error(`Image snapshot ${snapshotIndex} Tiltmark simulation byte length is inconsistent with its integrity proof.`);
    }
    return;
  }
  if (!stateProof.present) {
    if (payload !== null && payload !== undefined) {
      throw new Error(`Image snapshot ${snapshotIndex} has an unexpected native Tiltmark simulation payload.`);
    }
    return;
  }
  if (!isRecord(payload)
    || payload.format !== 'tiltmark-substrate-gzip-json'
    || payload.byteLength !== stateProof.byteLength
    || typeof payload.asset !== 'string') {
    throw new Error(`Image snapshot ${snapshotIndex} native Tiltmark simulation payload is malformed.`);
  }
}

function assertNativeAssetRef(value: unknown, width: number, height: number, label: string): void {
  if (
    !isRecord(value)
    || typeof value.asset !== 'string'
    || value.asset.length === 0
    || value.width !== width
    || value.height !== height
  ) {
    throw new Error(`${label} native asset reference does not match its integrity proof.`);
  }
}

function inspectRawSnapshotLayerIdentity(layers: readonly unknown[], proofs: readonly unknown[]): string[] {
  const reasons: string[] = [];
  const layerIds: string[] = [];
  for (const layer of layers) {
    if (!isRecord(layer) || !nonemptyIdentity(layer.id)) {
      reasons.push('empty-snapshot-layer-id');
    } else {
      layerIds.push(layer.id);
    }
  }
  const proofIds: string[] = [];
  for (const proof of proofs) {
    if (!isRecord(proof) || !nonemptyIdentity(proof.layerId)) {
      reasons.push('empty-layer-proof-id');
    } else {
      proofIds.push(proof.layerId);
    }
  }
  if (new Set(layerIds).size !== layerIds.length) reasons.push('duplicate-snapshot-layer-id');
  if (new Set(proofIds).size !== proofIds.length) reasons.push('duplicate-layer-proof');
  if (layers.length !== proofs.length) reasons.push('layer-count-mismatch');
  const layerIdSet = new Set(layerIds);
  const proofIdSet = new Set(proofIds);
  for (const layerId of layerIdSet) {
    if (!proofIdSet.has(layerId)) reasons.push(`missing-layer-proof:${layerId}`);
  }
  for (const proofId of proofIdSet) {
    if (!layerIdSet.has(proofId)) reasons.push(`extra-layer-proof:${proofId}`);
  }
  return [...new Set(reasons)];
}

function assertBoundedDimension(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > IMAGE_SNAPSHOT_MAX_DIMENSION) {
    throw new Error(`${label} must be an integer between 1 and ${IMAGE_SNAPSHOT_MAX_DIMENSION}.`);
  }
  return value as number;
}

function addBoundedAssetBytes(
  total: number,
  candidate: unknown,
  channels: number,
  label: string,
  maxAggregateBytes: number,
): number {
  if (!isRecord(candidate) || typeof candidate.present !== 'boolean') {
    throw new Error(`${label} is malformed.`);
  }
  if (!candidate.present) {
    if (candidate.width !== 0 || candidate.height !== 0 || candidate.contentDigest !== undefined) {
      throw new Error(`${label} absent proof is nonempty.`);
    }
    return total;
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(String(candidate.contentDigest ?? ''))) {
    throw new Error(`${label} has a malformed cryptographic content integrity digest.`);
  }
  const width = assertBoundedDimension(candidate.width, `${label} width`);
  const height = assertBoundedDimension(candidate.height, `${label} height`);
  return addAggregateBytes(total, safePixelByteLength(width, height, channels, label), maxAggregateBytes);
}

function safePixelByteLength(width: number, height: number, channels: number, label: string): number {
  const bytes = width * height * channels;
  if (!Number.isSafeInteger(bytes)) throw new Error(`${label} byte length is unsafe.`);
  return bytes;
}

function addAggregateBytes(total: number, bytes: number, maxAggregateBytes: number): number {
  const next = total + bytes;
  if (!Number.isSafeInteger(next) || next > maxAggregateBytes) {
    throw new Error(`Image snapshot aggregate pixels exceed ${maxAggregateBytes} bytes.`);
  }
  return next;
}

function assertImageSnapshotSourceBounds(
  layers: readonly ImageLayer[],
  selection?: SelectionMask | SelectionMaskSnapshot,
): void {
  if (layers.length > IMAGE_SNAPSHOT_MAX_LAYERS) {
    throw new Error(`Image snapshot layer count exceeds ${IMAGE_SNAPSHOT_MAX_LAYERS}.`);
  }
  const layerIds = layers.map((layer) => layer.id);
  if (layerIds.some((id) => !nonemptyIdentity(id)) || new Set(layerIds).size !== layerIds.length) {
    throw new Error('Image snapshot source layers require unique, nonempty ids.');
  }
  let aggregateBytes = 0;
  for (const layer of layers) {
    for (const [role, bitmap] of [
      ['bitmap', layer.bitmap],
      ['mask', layer.mask],
      ['tiltmarkBaseBitmap', layer.tiltmarkBaseBitmap ?? null],
    ] as const) {
      if (!bitmap) continue;
      const width = assertBoundedDimension(bitmap.width, `${layer.id} ${role} width`);
      const height = assertBoundedDimension(bitmap.height, `${layer.id} ${role} height`);
      aggregateBytes = addAggregateBytes(
        aggregateBytes,
        safePixelByteLength(width, height, 4, `${layer.id} ${role}`),
        IMAGE_SNAPSHOT_MAX_AGGREGATE_BYTES,
      );
    }
    if (layer.tiltmarkSimulationData) {
      const stateBytes = new TextEncoder().encode(layer.tiltmarkSimulationData).byteLength;
      if (stateBytes > MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH) {
        throw new Error(`${layer.id} Tiltmark simulation exceeds its bounded state limit.`);
      }
      const stateWidth = layer.bitmap?.width ?? layer.tiltmarkBaseBitmap?.width;
      const stateHeight = layer.bitmap?.height ?? layer.tiltmarkBaseBitmap?.height;
      if (
        layer.metadata?.tiltmark?.role === 'surface'
        && (!stateWidth
          || !stateHeight
          || !decodeImageTiltmarkSimulation(layer.tiltmarkSimulationData, stateWidth, stateHeight))
      ) {
        throw new Error(`${layer.id} Tiltmark simulation checkpoint is invalid.`);
      }
      aggregateBytes = addAggregateBytes(
        aggregateBytes,
        stateBytes,
        IMAGE_SNAPSHOT_MAX_AGGREGATE_BYTES,
      );
    }
  }
  if (selection) {
    const width = assertBoundedDimension(selection.width, 'snapshot selection width');
    const height = assertBoundedDimension(selection.height, 'snapshot selection height');
    const bytes = getSnapshotSelectionBytes(selection);
    const expectedBytes = safePixelByteLength(width, height, 1, 'snapshot selection');
    if (bytes.byteLength !== expectedBytes) throw new Error('Image snapshot selection byte length is inconsistent.');
    addAggregateBytes(aggregateBytes, expectedBytes, IMAGE_SNAPSHOT_MAX_AGGREGATE_BYTES);
  }
}

function snapshotContentDigest(input: {
  role: SnapshotAssetRole;
  layerId: string;
  width: number;
  height: number;
  bytes: Uint8Array | Uint8ClampedArray;
}): string {
  const layerIdBytes = new TextEncoder().encode(input.layerId);
  const header = new TextEncoder().encode(
    `signal-loom:image-snapshot-content:v2\0role=${input.role}\0layer-id-bytes=${layerIdBytes.byteLength}\0`,
  );
  const dimensions = new TextEncoder().encode(
    `\0width=${input.width}\0height=${input.height}\0byte-length=${input.bytes.byteLength}\0payload\0`,
  );
  const hasher = sha256.create();
  hasher.update(header);
  hasher.update(layerIdBytes);
  hasher.update(dimensions);
  hasher.update(new Uint8Array(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength));
  return `sha256:${[...hasher.digest()].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function snapshotAssetIntegrity(
  bitmap: LayerBitmap | null,
  layerId: string,
  role: Exclude<SnapshotAssetRole, 'selection-alpha8'>,
): ImageDocumentSnapshotAssetIntegrity {
  if (!bitmap) return { present: false, width: 0, height: 0 };
  const pixels = getBitmapImageData(bitmap).data;
  if (pixels.byteLength !== bitmap.width * bitmap.height * 4) {
    throw new Error(`Snapshot ${role} ${layerId} did not expose exact RGBA bytes.`);
  }
  return {
    present: true,
    width: bitmap.width,
    height: bitmap.height,
    contentDigest: snapshotContentDigest({
      role,
      layerId,
      width: bitmap.width,
      height: bitmap.height,
      bytes: pixels,
    }),
  };
}

function selectionAssetIntegrity(selection: SelectionMaskSnapshot | undefined): ImageDocumentSnapshotIntegrity['selection'] {
  const bytes = selection ? getSnapshotSelectionBytes(selection) : undefined;
  return selection
    ? {
        present: true,
        width: selection.width,
        height: selection.height,
        byteLength: bytes!.byteLength,
        contentDigest: snapshotContentDigest({
          role: 'selection-alpha8',
          layerId: '',
          width: selection.width,
          height: selection.height,
          bytes: bytes!,
        }),
      }
    : { present: false, width: 0, height: 0, byteLength: 0 };
}

function tiltmarkSimulationIntegrity(
  value: string | null | undefined,
  layerId: string,
): NonNullable<ImageDocumentSnapshotIntegrity['layers'][number]['tiltmarkSimulation']> {
  if (!value) return { present: false, byteLength: 0 };
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH) {
    throw new Error(`Snapshot Tiltmark simulation ${layerId} exceeds its bounded state limit.`);
  }
  return {
    present: true,
    byteLength: bytes.byteLength,
    contentDigest: snapshotContentDigest({
      role: 'tiltmark-simulation-gzip-json',
      layerId,
      width: 0,
      height: 0,
      bytes,
    }),
  };
}

export function buildImageDocumentSnapshotIntegrity(
  layers: readonly ImageLayer[],
  selectionMask?: SelectionMaskSnapshot,
): ImageDocumentSnapshotIntegrity {
  assertImageSnapshotSourceBounds(layers, selectionMask);
  return {
    version: 2,
    layers: layers.map((layer) => {
      const hasTiltmarkPayload = layer.metadata?.tiltmark?.role === 'surface'
        || Boolean(layer.tiltmarkBaseBitmap)
        || Boolean(layer.tiltmarkSimulationData);
      return {
        layerId: layer.id,
        bitmap: snapshotAssetIntegrity(layer.bitmap, layer.id, 'bitmap-rgba8'),
        mask: snapshotAssetIntegrity(layer.mask, layer.id, 'mask-rgba8'),
        ...(hasTiltmarkPayload
          ? {
              tiltmarkBase: snapshotAssetIntegrity(
                layer.tiltmarkBaseBitmap ?? null,
                layer.id,
                'tiltmark-base-rgba8',
              ),
              tiltmarkSimulation: tiltmarkSimulationIntegrity(
                layer.tiltmarkSimulationData,
                layer.id,
              ),
            }
          : {}),
      };
    }),
    selection: selectionAssetIntegrity(selectionMask),
  };
}

function validSelectionForDocument(
  selection: SelectionMask | SelectionMaskSnapshot | undefined,
  width: number,
  height: number,
): selection is SelectionMask | SelectionMaskSnapshot {
  const bytes = selection ? getSnapshotSelectionBytes(selection) : undefined;
  return Boolean(
    selection
    && selection.width === width
    && selection.height === height
    && bytes instanceof Uint8ClampedArray
    && bytes.byteLength === width * height
    && bytes.some((value) => value !== 0),
  );
}

function assetMatchesIntegrity(
  bitmap: LayerBitmap | null,
  expected: ImageDocumentSnapshotAssetIntegrity,
  layerId: string,
  role: Exclude<SnapshotAssetRole, 'selection-alpha8'>,
): boolean {
  if (!expected.present) {
    return bitmap === null
      && expected.width === 0
      && expected.height === 0
      && expected.contentDigest === undefined;
  }
  if (
    !bitmap
    || !Number.isFinite(expected.width)
    || !Number.isFinite(expected.height)
    || expected.width <= 0
    || expected.height <= 0
    || bitmap.width !== expected.width
    || bitmap.height !== expected.height
    || typeof expected.contentDigest !== 'string'
  ) return false;
  try {
    const actual = snapshotAssetIntegrity(bitmap, layerId, role);
    return actual.contentDigest === expected.contentDigest;
  } catch {
    return false;
  }
}

function tiltmarkSimulationMatchesIntegrity(
  value: string | null | undefined,
  expected: NonNullable<ImageDocumentSnapshotIntegrity['layers'][number]['tiltmarkSimulation']>,
  layerId: string,
): boolean {
  if (!expected.present) {
    return !value && expected.byteLength === 0 && expected.contentDigest === undefined;
  }
  if (!value) return false;
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength !== expected.byteLength || bytes.byteLength > MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH) {
    return false;
  }
  return expected.contentDigest === snapshotContentDigest({
    role: 'tiltmark-simulation-gzip-json',
    layerId,
    width: 0,
    height: 0,
    bytes,
  });
}

export interface ImageDocumentSnapshotIntegrityResult {
  complete: boolean;
  selectionComplete: boolean;
  reasons: string[];
}

function inspectSnapshotStructure(
  snapshot: ImageDocumentSnapshot,
  options: { requireResourceOwnFieldCoverage?: boolean } = {},
): ImageDocumentSnapshotIntegrityResult {
  try {
    return inspectSnapshotStructureUnchecked(snapshot, options);
  } catch {
    return { complete: false, selectionComplete: false, reasons: ['snapshot-bounds-invalid'] };
  }
}

function inspectSnapshotStructureUnchecked(
  snapshot: ImageDocumentSnapshot,
  options: { requireResourceOwnFieldCoverage?: boolean },
): ImageDocumentSnapshotIntegrityResult {
  const reasons: string[] = [];
  assertImageDocumentSnapshotDecodeBounds([snapshot], {
    transport: 'runtime',
    requireResourceOwnFieldCoverage: options.requireResourceOwnFieldCoverage,
  });
  const integrity = snapshot.integrity;
  if (snapshot.pixelState !== 'complete') reasons.push('pixel-state-unavailable');
  if (!integrity || integrity.version !== 2) {
    reasons.push('missing-integrity-manifest');
    return { complete: false, selectionComplete: !snapshot.hasSelection, reasons };
  }
  reasons.push(...inspectRawSnapshotLayerIdentity(snapshot.layers, integrity.layers));
  for (const proof of integrity.layers as unknown[]) {
    if (!isRecord(proof)) {
      reasons.push('malformed-layer-proof');
      continue;
    }
    if (!validAssetProofShape(proof.bitmap)) reasons.push(`malformed-bitmap-proof:${String(proof.layerId ?? '')}`);
    if (!validAssetProofShape(proof.mask)) reasons.push(`malformed-mask-proof:${String(proof.layerId ?? '')}`);
    const layer = snapshot.layers.find((candidate) => candidate.id === proof.layerId);
    const hasTiltmarkPayload = Boolean(
      layer?.metadata?.tiltmark?.role === 'surface'
      || layer?.tiltmarkBaseBitmap
      || layer?.tiltmarkSimulationData,
    );
    if (hasTiltmarkPayload) {
      const tiltmarkBaseProof = proof.tiltmarkBase;
      const tiltmarkSimulationProof = proof.tiltmarkSimulation;
      const validTiltmarkBaseProof = validAssetProofShape(tiltmarkBaseProof);
      const validTiltmarkSimulationProof =
        validTiltmarkSimulationProofShape(tiltmarkSimulationProof);
      if (!validTiltmarkBaseProof) {
        reasons.push(`malformed-tiltmark-base-proof:${String(proof.layerId ?? '')}`);
      }
      if (!validTiltmarkSimulationProof) {
        reasons.push(`malformed-tiltmark-simulation-proof:${String(proof.layerId ?? '')}`);
      }
      if (
        layer?.metadata?.tiltmark?.role === 'surface'
        && (!validTiltmarkBaseProof || tiltmarkBaseProof.present !== true)
      ) {
        reasons.push(`missing-tiltmark-base-proof:${String(proof.layerId ?? '')}`);
      }
      if (
        layer?.metadata?.tiltmark?.materialState === 'physical'
        && (!validTiltmarkSimulationProof || tiltmarkSimulationProof.present !== true)
      ) {
        reasons.push(`missing-tiltmark-simulation-proof:${String(proof.layerId ?? '')}`);
      }
    } else if (proof.tiltmarkBase !== undefined || proof.tiltmarkSimulation !== undefined) {
      reasons.push(`unexpected-tiltmark-proof:${String(proof.layerId ?? '')}`);
    }
  }
  let selectionComplete = true;
  const selectionProof = integrity.selection;
  if (
    !validAssetProofShape(selectionProof)
    || !Number.isSafeInteger(selectionProof.byteLength)
    || selectionProof.byteLength < 0
    || (selectionProof.present && selectionProof.byteLength !== selectionProof.width * selectionProof.height)
    || (!selectionProof.present && selectionProof.byteLength !== 0)
  ) {
    reasons.push('malformed-selection-proof');
    selectionComplete = false;
  }
  if (selectionProof.present !== snapshot.hasSelection) {
    reasons.push('selection-claim-mismatch');
    selectionComplete = false;
  } else if (!selectionProof.present && (
    snapshot.selectionMask
    || selectionProof.width !== 0
    || selectionProof.height !== 0
    || selectionProof.byteLength !== 0
    || selectionProof.contentDigest !== undefined
  )) {
    reasons.push('unexpected-selection-payload');
    selectionComplete = false;
  }
  return { complete: reasons.length === 0, selectionComplete, reasons: [...new Set(reasons)] };
}

function validAssetProofShape(proof: unknown): proof is ImageDocumentSnapshotAssetIntegrity {
  if (!isRecord(proof) || typeof proof.present !== 'boolean') return false;
  if (proof.present) {
    return typeof proof.width === 'number'
      && typeof proof.height === 'number'
      && Number.isSafeInteger(proof.width)
      && Number.isSafeInteger(proof.height)
      && proof.width > 0
      && proof.height > 0
      && typeof proof.contentDigest === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(proof.contentDigest);
  }
  return proof.width === 0
    && proof.height === 0
    && proof.contentDigest === undefined;
}

function validTiltmarkSimulationProofShape(
  proof: unknown,
): proof is NonNullable<ImageDocumentSnapshotIntegrity['layers'][number]['tiltmarkSimulation']> {
  if (!isRecord(proof) || typeof proof.present !== 'boolean') return false;
  if (!Number.isSafeInteger(proof.byteLength) || Number(proof.byteLength) < 0) return false;
  if (proof.present) {
    return Number(proof.byteLength) > 0
      && Number(proof.byteLength) <= MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH
      && typeof proof.contentDigest === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(proof.contentDigest);
  }
  return proof.byteLength === 0 && proof.contentDigest === undefined;
}

/** Explicit O(pixel) verification boundary used by create/decode/save/Restore. */
export function verifyImageDocumentSnapshotIntegrity(
  snapshot: ImageDocumentSnapshot,
): ImageDocumentSnapshotIntegrityResult {
  let structure = inspectSnapshotStructure(snapshot);
  if (!structure.complete) return structure;
  const cached = verifiedNamedSnapshots.get(snapshot);
  const reuseControlledResources = Boolean(
    cached
    && verifiedResourceIdentitiesMatch(snapshot, cached)
    && inspectSnapshotStructure(snapshot, { requireResourceOwnFieldCoverage: true }).complete
    && verifiedBindingMatches(snapshot, cached),
  );
  let prepared: PreparedSnapshotResourceCoverage;
  try {
    prepared = prepareSnapshotResourceCoverage(snapshot, reuseControlledResources);
    prepared.commit();
  } catch {
    return {
      complete: false,
      selectionComplete: false,
      reasons: ['snapshot-resource-hardening-failed'],
    };
  }
  structure = inspectSnapshotStructure(snapshot, { requireResourceOwnFieldCoverage: true });
  if (!structure.complete) {
    prepared.rollback();
    return structure;
  }
  const integrity = snapshot.integrity!;
  const reasons: string[] = [];
  const layerProofById = new Map(integrity.layers.map((layer) => [layer.layerId, layer] as const));
  for (const layer of snapshot.layers) {
    const proof = layerProofById.get(layer.id)!;
    if (!assetMatchesIntegrity(layer.bitmap, proof.bitmap, layer.id, 'bitmap-rgba8')) {
      reasons.push(`bitmap-content-digest-mismatch:${layer.id}`);
    }
    if (!assetMatchesIntegrity(layer.mask, proof.mask, layer.id, 'mask-rgba8')) {
      reasons.push(`mask-content-digest-mismatch:${layer.id}`);
    }
    if (proof.tiltmarkBase && !assetMatchesIntegrity(
      layer.tiltmarkBaseBitmap ?? null,
      proof.tiltmarkBase,
      layer.id,
      'tiltmark-base-rgba8',
    )) {
      reasons.push(`tiltmark-base-content-digest-mismatch:${layer.id}`);
    }
    if (proof.tiltmarkSimulation && !tiltmarkSimulationMatchesIntegrity(
      layer.tiltmarkSimulationData,
      proof.tiltmarkSimulation,
      layer.id,
    )) {
      reasons.push(`tiltmark-simulation-content-digest-mismatch:${layer.id}`);
    }
  }

  const selectionProof = integrity.selection;
  let selectionComplete = true;
  if (selectionProof.present) {
    const selection = snapshot.selectionMask;
    const selectionBytes = selection ? getSnapshotSelectionBytes(selection) : undefined;
    selectionComplete = Boolean(
      validSelectionForDocument(selection, snapshot.width, snapshot.height)
      && selectionProof.width === selection.width
      && selectionProof.height === selection.height
      && selectionBytes
      && selectionProof.byteLength === selectionBytes.byteLength
      && typeof selectionProof.contentDigest === 'string'
      && selectionProof.contentDigest === snapshotContentDigest({
        role: 'selection-alpha8',
        layerId: '',
        width: selection.width,
        height: selection.height,
        bytes: selectionBytes,
      }),
    );
    if (!selectionComplete) reasons.push('selection-payload-mismatch');
  }
  const result = { complete: reasons.length === 0, selectionComplete, reasons };
  if (!result.complete) {
    prepared.rollback();
    return result;
  }
  if (result.complete && ownedNamedSnapshots.has(snapshot)) {
    try {
      cacheVerifiedOwnedSnapshot(snapshot, result);
      prepared.finalize();
    } catch {
      prepared.rollback();
      return {
        complete: false,
        selectionComplete: false,
        reasons: ['snapshot-resource-hardening-failed'],
      };
    }
  } else {
    prepared.rollback();
  }
  return result;
}

/**
 * Cheap runtime readiness query. Production-owned snapshots enter this cache
 * only after an explicit deep verification boundary and are bound to the exact
 * snapshot/layer/resource/manifest graph.
 */
export function inspectImageDocumentSnapshotIntegrity(
  snapshot: ImageDocumentSnapshot,
): ImageDocumentSnapshotIntegrityResult {
  const cached = verifiedNamedSnapshots.get(snapshot);
  if (cached) {
    if (!verifiedResourceIdentitiesMatch(snapshot, cached)) {
      return {
        complete: false,
        selectionComplete: false,
        reasons: ['verified-snapshot-binding-changed'],
      };
    }
    const structure = inspectSnapshotStructure(snapshot, { requireResourceOwnFieldCoverage: true });
    if (!structure.complete) return structure;
    return verifiedBindingMatches(snapshot, cached)
      ? cached.result
      : {
          complete: false,
          selectionComplete: false,
          reasons: ['verified-snapshot-binding-changed'],
        };
  }
  const structure = inspectSnapshotStructure(snapshot);
  if (!structure.complete) return structure;
  const result = verifyImageDocumentSnapshotIntegrity(snapshot);
  if (result.complete && ownedNamedSnapshots.has(snapshot)) cacheVerifiedOwnedSnapshot(snapshot, result);
  return result;
}

export function markImageDocumentSnapshotOwned(snapshot: ImageDocumentSnapshot): ImageDocumentSnapshot {
  ownedNamedSnapshots.add(snapshot);
  return snapshot;
}

/** Register a freshly built manifest whose exact bytes were hashed by the builder. */
export function markImageDocumentSnapshotVerifiedOwned(snapshot: ImageDocumentSnapshot): ImageDocumentSnapshot {
  const wasOwned = ownedNamedSnapshots.has(snapshot);
  markImageDocumentSnapshotOwned(snapshot);
  let structure = inspectSnapshotStructure(snapshot);
  if (!structure.complete) {
    if (!wasOwned) ownedNamedSnapshots.delete(snapshot);
    throw new Error(`Image snapshot cannot enter verified state: ${structure.reasons.join(', ')}.`);
  }
  let prepared: PreparedSnapshotResourceCoverage | undefined;
  try {
    const cached = verifiedNamedSnapshots.get(snapshot);
    const reuseControlledResources = Boolean(
      cached
      && verifiedResourceIdentitiesMatch(snapshot, cached)
      && inspectSnapshotStructure(snapshot, { requireResourceOwnFieldCoverage: true }).complete
      && verifiedBindingMatches(snapshot, cached),
    );
    prepared = prepareSnapshotResourceCoverage(snapshot, reuseControlledResources);
    prepared.commit();
    structure = inspectSnapshotStructure(snapshot, { requireResourceOwnFieldCoverage: true });
    if (!structure.complete) {
      throw new Error(`Image snapshot cannot enter verified state: ${structure.reasons.join(', ')}.`);
    }
    cacheVerifiedOwnedSnapshot(snapshot, { complete: true, selectionComplete: true, reasons: [] });
    prepared.finalize();
  } catch (error) {
    prepared?.rollback();
    if (!wasOwned) ownedNamedSnapshots.delete(snapshot);
    verifiedNamedSnapshots.delete(snapshot);
    if (error instanceof UnsupportedLayerBitmapPlatformError) throw error;
    throw new Error('Image snapshot resources could not enter immutable verified state.', { cause: error });
  }
  return snapshot;
}

function cacheVerifiedOwnedSnapshot(
  snapshot: ImageDocumentSnapshot,
  result: ImageDocumentSnapshotIntegrityResult,
): void {
  for (const layer of snapshot.layers) {
    for (const bitmap of [layer.bitmap, layer.mask]) {
      if (bitmap && !isBitmapImmutable(bitmap)) {
        throw new Error('Image snapshot cache received an uncontrolled bitmap resource.');
      }
    }
  }
  if (snapshot.selectionMask) makeSelectionSnapshotImmutable(snapshot.selectionMask);
  verifiedNamedSnapshots.set(snapshot, captureVerifiedBinding(snapshot, result));
}

function makeSelectionSnapshotImmutable(selection: SelectionMaskSnapshot): void {
  if (immutableSelectionBytes.has(selection)) return;
  const record = { bytes: new Uint8ClampedArray(selection.data) };
  Object.defineProperties(selection, {
    width: { configurable: false, enumerable: true, writable: false, value: selection.width },
    height: { configurable: false, enumerable: true, writable: false, value: selection.height },
    data: {
      configurable: false,
      enumerable: true,
      get: () => new Uint8ClampedArray(record.bytes),
      set: () => {
        throw new Error('Verified Image snapshot selections are immutable.');
      },
    },
  });
  immutableSelectionBytes.set(selection, record);
  Object.freeze(selection);
}

function getSnapshotSelectionBytes(selection: SelectionMask | SelectionMaskSnapshot): Uint8ClampedArray {
  return immutableSelectionBytes.get(selection as SelectionMaskSnapshot)?.bytes ?? selection.data;
}

function assetProofSignature(proof: ImageDocumentSnapshotAssetIntegrity): string {
  return `${proof.present}:${proof.width}:${proof.height}:${proof.contentDigest ?? ''}`;
}

function tiltmarkSimulationProofSignature(
  proof: ImageDocumentSnapshotIntegrity['layers'][number]['tiltmarkSimulation'],
): string {
  return proof ? `${proof.present}:${proof.byteLength}:${proof.contentDigest ?? ''}` : 'absent';
}

function snapshotBindingSignature(snapshot: ImageDocumentSnapshot): string {
  return `${snapshot.pixelState}:${snapshot.width}:${snapshot.height}:${snapshot.hasSelection}:${snapshot.layers.length}`;
}

function selectionProofSignature(proof: ImageDocumentSnapshotIntegrity['selection']): string {
  return `${assetProofSignature(proof)}:${proof.byteLength}`;
}

interface BitmapMetadataBinding {
  signature: string;
  symbols: readonly symbol[];
}

interface MetadataSymbolIdentity {
  ids: Map<symbol, number>;
  symbols: symbol[];
}

function metadataSymbolIdentityToken(
  value: symbol,
  identity: MetadataSymbolIdentity,
  kind: 'key' | 'value',
): string {
  let id = identity.ids.get(value);
  if (id === undefined) {
    id = identity.symbols.length;
    identity.ids.set(value, id);
    identity.symbols.push(value);
  }
  const globalKey = Symbol.keyFor(value);
  const description = value.description ?? '';
  return `symbol-${kind}:${id}:global:${globalKey === undefined ? -1 : globalKey.length}:${globalKey ?? ''}:description:${description.length}:${description}`;
}

function metadataBindingKeyToken(key: PropertyKey, identity: MetadataSymbolIdentity): string {
  return typeof key === 'symbol'
    ? metadataSymbolIdentityToken(key, identity, 'key')
    : metadataKeyToken(key);
}

/** Bind every own enumerable string/symbol resource field without pixel readback. */
function captureBitmapMetadataBinding(bitmap: LayerBitmap | null): BitmapMetadataBinding {
  if (!bitmap) return { signature: 'absent', symbols: [] };
  const hasher = sha256.create();
  const encoder = new TextEncoder();
  const seen = new WeakMap<object, number>();
  const symbolIdentity: MetadataSymbolIdentity = { ids: new Map(), symbols: [] };
  const stack: Array<
    | { kind: 'token'; value: string }
    | { kind: 'value'; value: unknown; resourceRoot: boolean; depth: number }
  > = [{ kind: 'value', value: bitmap, resourceRoot: true, depth: 0 }];
  let descriptorBytes = 0;
  let nextObjectId = 0;
  const maxDescriptorBytes = IMAGE_SNAPSHOT_MAX_METADATA_BYTES * 2;
  const update = (token: string) => {
    for (let offset = 0; offset < token.length; offset += 8_192) {
      const bytes = encoder.encode(token.slice(offset, offset + 8_192));
      descriptorBytes += bytes.byteLength;
      if (descriptorBytes > maxDescriptorBytes) {
        throw new Error('Image snapshot bitmap metadata descriptor exceeds its bounded budget.');
      }
      hasher.update(bytes);
    }
  };
  const updateBinary = (bytes: Uint8Array) => {
    descriptorBytes += bytes.byteLength;
    if (descriptorBytes > maxDescriptorBytes) {
      throw new Error('Image snapshot bitmap metadata descriptor exceeds its bounded budget.');
    }
    hasher.update(bytes);
  };

  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (entry.kind === 'token') {
      update(entry.value);
      continue;
    }
    const value = entry.value;
    if (entry.depth > IMAGE_SNAPSHOT_MAX_METADATA_DEPTH) {
      throw new Error(`Image snapshot bitmap metadata depth exceeds ${IMAGE_SNAPSHOT_MAX_METADATA_DEPTH}.`);
    }
    if (value === null) {
      update('null;');
    } else if (typeof value === 'string') {
      update(`string:${value.length}:`);
      update(value);
      update(';');
    } else if (typeof value === 'number') {
      update(`number:${Number.isFinite(value) ? String(value) : 'null'};`);
    } else if (typeof value === 'boolean') {
      update(`boolean:${value};`);
    } else if (typeof value === 'bigint') {
      update(`bigint:${String(value)};`);
    } else if (value === undefined) {
      update('undefined;');
    } else if (typeof value === 'function') {
      throw new Error('Image snapshot callable metadata is unsupported and cannot enter snapshot ownership.');
    } else if (typeof value === 'symbol') {
      update(`${metadataSymbolIdentityToken(value, symbolIdentity, 'value')};`);
    } else {
      const priorId = seen.get(value);
      if (priorId !== undefined) {
        update(`reference:${priorId};`);
        continue;
      }
      const objectId = nextObjectId;
      nextObjectId += 1;
      seen.set(value, objectId);
      if (ArrayBuffer.isView(value)) {
        const bytes = exactBinaryBytes(value);
        update(`binary-view:${Object.prototype.toString.call(value)}:${value.byteOffset}:${bytes.byteLength};`);
        updateBinary(bytes);
        continue;
      }
      if (value instanceof ArrayBuffer) {
        const bytes = exactBinaryBytes(value);
        update(`array-buffer:${bytes.byteLength};`);
        updateBinary(bytes);
        continue;
      }
      if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
        update(`image-data:${value.width}:${value.height}:${value.data.byteLength};`);
        updateBinary(new Uint8Array(value.data.buffer, value.data.byteOffset, value.data.byteLength));
        continue;
      }

      const record = value as UnknownPropertyRecord;
      const entries = enumerableOwnEntries(record);
      update(Array.isArray(value)
        ? `array:${objectId}:length:${value.length}:keys:${entries.length}{`
        : `object:${objectId}:keys:${entries.length}{`);
      stack.push({ kind: 'token', value: '}' });
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const { key, descriptor } = entries[index];
        if (!('value' in descriptor)) {
          if (entry.resourceRoot && isImmutableBitmapDimensionDescriptor(record, key)) {
            stack.push({
              kind: 'token',
              value: `${metadataBindingKeyToken(key, symbolIdentity)}:immutable-dimension;`,
            });
            continue;
          }
          throw new Error('Image snapshot bitmap metadata descriptor is not safely readable.');
        }
        stack.push({ kind: 'token', value: ';' });
        stack.push({
          kind: 'value',
          value: descriptor.value,
          resourceRoot: false,
          depth: entry.depth + 1,
        });
        stack.push({
          kind: 'token',
          value: `${metadataBindingKeyToken(key, symbolIdentity)}:w${descriptor.writable === true ? 1 : 0}:c${descriptor.configurable === true ? 1 : 0}:`,
        });
      }
    }
  }
  return {
    signature: `sha256:${[...hasher.digest()].map((value) => value.toString(16).padStart(2, '0')).join('')}`,
    symbols: symbolIdentity.symbols,
  };
}

function metadataSymbolsMatch(left: readonly symbol[], right: readonly symbol[]): boolean {
  return left.length === right.length && left.every((symbol, index) => symbol === right[index]);
}

function captureVerifiedBinding(
  snapshot: ImageDocumentSnapshot,
  result: ImageDocumentSnapshotIntegrityResult,
): VerifiedSnapshotBinding {
  const integrity = snapshot.integrity!;
  const proofById = new Map(integrity.layers.map((proof) => [proof.layerId, proof] as const));
  return {
    layers: snapshot.layers,
    integrity,
    proofLayers: integrity.layers,
    selectionProof: integrity.selection,
    selectionProofSignature: selectionProofSignature(integrity.selection),
    selectionMask: snapshot.selectionMask,
    selectionBytes: snapshot.selectionMask ? getSnapshotSelectionBytes(snapshot.selectionMask) : undefined,
    snapshotSignature: snapshotBindingSignature(snapshot),
    layerBindings: snapshot.layers.map((layer) => {
      const proof = proofById.get(layer.id)!;
      const bitmapMetadata = captureBitmapMetadataBinding(layer.bitmap);
      const maskMetadata = captureBitmapMetadataBinding(layer.mask);
      const tiltmarkBaseMetadata = captureBitmapMetadataBinding(layer.tiltmarkBaseBitmap ?? null);
      return {
        layer,
        id: layer.id,
        bitmap: layer.bitmap,
        bitmapWidth: layer.bitmap?.width ?? 0,
        bitmapHeight: layer.bitmap?.height ?? 0,
        bitmapMetadataSignature: bitmapMetadata.signature,
        bitmapMetadataSymbols: bitmapMetadata.symbols,
        mask: layer.mask,
        maskWidth: layer.mask?.width ?? 0,
        maskHeight: layer.mask?.height ?? 0,
        maskMetadataSignature: maskMetadata.signature,
        maskMetadataSymbols: maskMetadata.symbols,
        tiltmarkBaseBitmap: layer.tiltmarkBaseBitmap ?? null,
        tiltmarkBaseWidth: layer.tiltmarkBaseBitmap?.width ?? 0,
        tiltmarkBaseHeight: layer.tiltmarkBaseBitmap?.height ?? 0,
        tiltmarkBaseMetadataSignature: tiltmarkBaseMetadata.signature,
        tiltmarkBaseMetadataSymbols: tiltmarkBaseMetadata.symbols,
        tiltmarkSimulationData: layer.tiltmarkSimulationData,
        proof,
        proofLayerId: proof.layerId,
        bitmapProof: proof.bitmap,
        bitmapProofSignature: assetProofSignature(proof.bitmap),
        maskProof: proof.mask,
        maskProofSignature: assetProofSignature(proof.mask),
        tiltmarkBaseProof: proof.tiltmarkBase,
        tiltmarkBaseProofSignature: proof.tiltmarkBase
          ? assetProofSignature(proof.tiltmarkBase)
          : 'absent',
        tiltmarkSimulationProofSignature: tiltmarkSimulationProofSignature(
          proof.tiltmarkSimulation,
        ),
      };
    }),
    result,
  };
}

function verifiedBindingMatches(snapshot: ImageDocumentSnapshot, binding: VerifiedSnapshotBinding): boolean {
  try {
    return verifiedBindingMatchesUnchecked(snapshot, binding);
  } catch {
    return false;
  }
}

function verifiedResourceIdentitiesMatch(
  snapshot: ImageDocumentSnapshot,
  binding: VerifiedSnapshotBinding,
): boolean {
  try {
    return snapshot.layers === binding.layers
      && snapshot.layers.length === binding.layerBindings.length
      && binding.layerBindings.every((expected, index) => {
        const layer = snapshot.layers[index];
        return layer === expected.layer
          && layer.bitmap === expected.bitmap
          && layer.mask === expected.mask
          && (layer.tiltmarkBaseBitmap ?? null) === expected.tiltmarkBaseBitmap
          && layer.tiltmarkSimulationData === expected.tiltmarkSimulationData;
      });
  } catch {
    return false;
  }
}

function verifiedBindingMatchesUnchecked(
  snapshot: ImageDocumentSnapshot,
  binding: VerifiedSnapshotBinding,
): boolean {
  if (
    snapshot.layers !== binding.layers
    || snapshot.integrity !== binding.integrity
    || snapshot.integrity.layers !== binding.proofLayers
    || snapshot.integrity.selection !== binding.selectionProof
    || snapshot.selectionMask !== binding.selectionMask
    || snapshotBindingSignature(snapshot) !== binding.snapshotSignature
    || selectionProofSignature(snapshot.integrity.selection) !== binding.selectionProofSignature
    || (snapshot.selectionMask ? getSnapshotSelectionBytes(snapshot.selectionMask) : undefined) !== binding.selectionBytes
    || snapshot.layers.length !== binding.layerBindings.length
  ) return false;
  const proofById = new Map(snapshot.integrity.layers.map((proof) => [proof.layerId, proof] as const));
  return binding.layerBindings.every((expected, index) => {
    const layer = snapshot.layers[index];
    const proof = proofById.get(layer.id);
    const bitmapMetadata = captureBitmapMetadataBinding(layer.bitmap);
    const maskMetadata = captureBitmapMetadataBinding(layer.mask);
    const tiltmarkBaseMetadata = captureBitmapMetadataBinding(layer.tiltmarkBaseBitmap ?? null);
    return layer === expected.layer
      && layer.id === expected.id
      && layer.bitmap === expected.bitmap
      && (layer.bitmap?.width ?? 0) === expected.bitmapWidth
      && (layer.bitmap?.height ?? 0) === expected.bitmapHeight
      && bitmapMetadata.signature === expected.bitmapMetadataSignature
      && metadataSymbolsMatch(bitmapMetadata.symbols, expected.bitmapMetadataSymbols)
      && layer.mask === expected.mask
      && (layer.mask?.width ?? 0) === expected.maskWidth
      && (layer.mask?.height ?? 0) === expected.maskHeight
      && maskMetadata.signature === expected.maskMetadataSignature
      && metadataSymbolsMatch(maskMetadata.symbols, expected.maskMetadataSymbols)
      && (layer.tiltmarkBaseBitmap ?? null) === expected.tiltmarkBaseBitmap
      && (layer.tiltmarkBaseBitmap?.width ?? 0) === expected.tiltmarkBaseWidth
      && (layer.tiltmarkBaseBitmap?.height ?? 0) === expected.tiltmarkBaseHeight
      && tiltmarkBaseMetadata.signature === expected.tiltmarkBaseMetadataSignature
      && metadataSymbolsMatch(tiltmarkBaseMetadata.symbols, expected.tiltmarkBaseMetadataSymbols)
      && layer.tiltmarkSimulationData === expected.tiltmarkSimulationData
      && proof === expected.proof
      && proof.layerId === expected.proofLayerId
      && proof.bitmap === expected.bitmapProof
      && assetProofSignature(proof.bitmap) === expected.bitmapProofSignature
      && proof.mask === expected.maskProof
      && assetProofSignature(proof.mask) === expected.maskProofSignature
      && proof.tiltmarkBase === expected.tiltmarkBaseProof
      && (proof.tiltmarkBase ? assetProofSignature(proof.tiltmarkBase) : 'absent')
        === expected.tiltmarkBaseProofSignature
      && tiltmarkSimulationProofSignature(proof.tiltmarkSimulation)
        === expected.tiltmarkSimulationProofSignature;
  });
}

function collectSnapshotBitmaps(snapshot: ImageDocumentSnapshot, target: Set<LayerBitmap>): void {
  for (const layer of snapshot.layers) {
    if (layer.bitmap) target.add(layer.bitmap);
    if (layer.mask) target.add(layer.mask);
    if (layer.tiltmarkBaseBitmap) target.add(layer.tiltmarkBaseBitmap);
  }
  for (const bitmap of supersededOwnedBitmaps.get(snapshot) ?? []) target.add(bitmap);
}

function collectDocumentLiveBitmaps(document: ImageDocument, target: Set<LayerBitmap>): void {
  for (const layer of document.layers) {
    if (layer.bitmap) target.add(layer.bitmap);
    if (layer.mask) target.add(layer.mask);
    if (layer.tiltmarkBaseBitmap) target.add(layer.tiltmarkBaseBitmap);
  }
}

/** Release only clones explicitly owned by named snapshots; safe to call repeatedly. */
export function disposeImageDocumentSnapshotResources(
  snapshot: ImageDocumentSnapshot,
  protectedBitmaps: ReadonlySet<LayerBitmap> = new Set(),
): void {
  if (!ownedNamedSnapshots.has(snapshot)) return;
  verifiedNamedSnapshots.delete(snapshot);
  if (snapshot.selectionMask) {
    const selectionRecord = immutableSelectionBytes.get(snapshot.selectionMask);
    if (selectionRecord) {
      selectionRecord.bytes = new Uint8ClampedArray(0);
      immutableSelectionBytes.delete(snapshot.selectionMask);
    }
  }
  const bitmaps = new Set<LayerBitmap>();
  collectSnapshotBitmaps(snapshot, bitmaps);
  for (const bitmap of bitmaps) {
    if (protectedBitmaps.has(bitmap)) continue;
    if (bitmap.width !== 0 || bitmap.height !== 0) {
      releaseImmutableBitmap(bitmap);
      bitmap.width = 0;
      bitmap.height = 0;
    }
  }
  supersededOwnedBitmaps.delete(snapshot);
  ownedNamedSnapshots.delete(snapshot);
}

export function disposeImageDocumentSnapshotsRemoved(
  before: ImageDocument,
  after: ImageDocument,
): void {
  const retained = new Set(after.snapshots ?? []);
  const protectedBitmaps = new Set<LayerBitmap>();
  collectDocumentLiveBitmaps(before, protectedBitmaps);
  for (const snapshot of after.snapshots ?? []) collectSnapshotBitmaps(snapshot, protectedBitmaps);
  for (const snapshot of before.snapshots ?? []) {
    if (!retained.has(snapshot)) disposeImageDocumentSnapshotResources(snapshot, protectedBitmaps);
  }
}

export function disposeImageDocumentNamedSnapshots(document: ImageDocument): void {
  const protectedBitmaps = new Set<LayerBitmap>();
  collectDocumentLiveBitmaps(document, protectedBitmaps);
  for (const snapshot of document.snapshots ?? []) {
    disposeImageDocumentSnapshotResources(snapshot, protectedBitmaps);
  }
}

export function captureImageDocumentSelectionState(document: ImageDocument): ImageDocument {
  const selection = document.hasSelection ? getSelection(document.id) : undefined;
  const selectionMask = validSelectionForDocument(selection, document.width, document.height)
    ? toSnapshot(selection)
    : undefined;
  return {
    ...document,
    hasSelection: Boolean(selectionMask),
    selectionMask,
    selectionMaskData: undefined,
  };
}

export function applyImageDocumentSelectionState(document: ImageDocument): ImageDocument {
  const selectionMask = document.hasSelection
    && validSelectionForDocument(document.selectionMask, document.width, document.height)
    ? toSnapshot(document.selectionMask)
    : undefined;
  clearSelection(document.id);
  if (selectionMask) setSelection(document.id, fromSnapshot(selectionMask));
  return {
    ...document,
    hasSelection: Boolean(selectionMask),
    selectionMask: undefined,
    selectionMaskData: undefined,
  };
}

export function createImageDocumentSnapshot(
  doc: ImageDocument,
  name = `Snapshot ${(doc.snapshots?.length ?? 0) + 1}`,
): ImageDocumentSnapshot {
  const createdAt = Date.now();
  const liveSelection = doc.hasSelection ? getSelection(doc.id) : undefined;
  assertBoundedDimension(doc.width, 'snapshot document width');
  assertBoundedDimension(doc.height, 'snapshot document height');
  assertImageSnapshotSourceBounds(doc.layers, liveSelection);
  const selectionMask = validSelectionForDocument(liveSelection, doc.width, doc.height)
    ? toSnapshot(liveSelection)
    : undefined;
  const layers = cloneSnapshotLayers(doc.layers);
  return markImageDocumentSnapshotVerifiedOwned({
    id: `snapshot-${createdAt}-${Math.floor(Math.random() * 1000)}`,
    name: normalizeSnapshotName(name, doc),
    createdAt,
    width: doc.width,
    height: doc.height,
    layers,
    activeLayerId: doc.activeLayerId,
    hasSelection: Boolean(selectionMask),
    selectionVersion: doc.selectionVersion,
    ...(selectionMask ? { selectionMask } : {}),
    pixelState: 'complete',
    integrity: buildImageDocumentSnapshotIntegrity(layers, selectionMask),
  });
}

export function addImageDocumentSnapshot(
  doc: ImageDocument,
  snapshot: ImageDocumentSnapshot = createImageDocumentSnapshot(doc),
  options: { deferDisposal?: boolean } = {},
): ImageDocument {
  const next = {
    ...doc,
    snapshots: [...(doc.snapshots ?? []), snapshot].slice(-IMAGE_DOCUMENT_MAX_SNAPSHOTS),
    dirty: true,
  };
  if (!options.deferDisposal) disposeImageDocumentSnapshotsRemoved(doc, next);
  return next;
}

export function restoreImageDocumentSnapshot(
  doc: ImageDocument,
  snapshotId: string,
): ImageDocument {
  const snapshot = doc.snapshots?.find((candidate) => candidate.id === snapshotId);
  if (!snapshot || !hasValidSnapshotDimensions(snapshot) || !verifyImageDocumentSnapshotIntegrity(snapshot).complete) return doc;
  const selectionMask = snapshot.hasSelection && snapshot.selectionMask
    ? toSnapshot(snapshot.selectionMask)
    : undefined;
  if (selectionMask) {
    setSelection(doc.id, fromSnapshot(selectionMask));
  } else {
    clearSelection(doc.id);
  }
  return {
    ...doc,
    width: getRestorableSnapshotDimension(snapshot.width, doc.width),
    height: getRestorableSnapshotDimension(snapshot.height, doc.height),
    layers: restoreSnapshotLayers(snapshot.layers),
    activeLayerId: snapshot.activeLayerId,
    hasSelection: Boolean(selectionMask),
    selectionVersion: snapshot.selectionVersion + 1,
    ...(selectionMask ? { selectionMask } : { selectionMask: undefined }),
    selectionMaskData: undefined,
    dirty: true,
  };
}

function getRestorableSnapshotDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function restoreSnapshotLayers(snapshotLayers: ImageLayer[]): ImageLayer[] {
  return cloneSnapshotLayers(snapshotLayers);
}

function cloneSnapshotLayers(layers: readonly ImageLayer[]): ImageLayer[] {
  const bitmapClones = new Map<NonNullable<ImageLayer['bitmap']>, NonNullable<ImageLayer['bitmap']>>();
  const cloneLayerBitmap = (bitmap: ImageLayer['bitmap']): ImageLayer['bitmap'] => {
    if (!bitmap) return null;
    const existing = bitmapClones.get(bitmap);
    if (existing) return existing;
    const cloned = cloneBitmap(bitmap);
    bitmapClones.set(bitmap, cloned);
    return cloned;
  };
  return layers.map((layer) => {
    const { bitmap, mask, tiltmarkBaseBitmap, ...serializable } = layer;
    const clonedSerializable = typeof structuredClone === 'function'
      ? structuredClone(serializable)
      : JSON.parse(JSON.stringify(serializable)) as typeof serializable;
    return {
      ...clonedSerializable,
      bitmap: cloneLayerBitmap(bitmap),
      mask: cloneLayerBitmap(mask),
      tiltmarkBaseBitmap: cloneLayerBitmap(tiltmarkBaseBitmap ?? null),
    };
  });
}

function hasValidSnapshotDimensions(snapshot: ImageDocumentSnapshot): boolean {
  return Number.isFinite(snapshot.width)
    && Number.isFinite(snapshot.height)
    && snapshot.width > 0
    && snapshot.height > 0;
}

function compactSnapshotName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function buildNamedSnapshotReadiness(snapshot: ImageDocumentSnapshot): ImageNamedSnapshotReadiness {
  const blockers: ImageSnapshotReadinessIssue[] = [];
  const warnings: ImageSnapshotReadinessIssue[] = [];
  const validDimensions = hasValidSnapshotDimensions(snapshot);

  if (!validDimensions) {
    blockers.push({
      code: 'invalid-snapshot-dimensions',
      severity: 'error',
      snapshotId: snapshot.id,
      message: `Snapshot ${snapshot.id} has invalid stored dimensions.`,
    });
  }

  const integrity = inspectImageDocumentSnapshotIntegrity(snapshot);
  if (snapshot.pixelState !== 'complete') {
    blockers.push({
      code: 'snapshot-pixels-unavailable',
      severity: 'error',
      snapshotId: snapshot.id,
      message: `Snapshot ${snapshot.id} predates pixel-complete snapshots and cannot be restored safely.`,
    });
  }

  if (snapshot.pixelState === 'complete' && !snapshot.integrity) {
    blockers.push({
      code: 'snapshot-integrity-unproven',
      severity: 'error',
      snapshotId: snapshot.id,
      message: `Snapshot ${snapshot.id} has no cryptographic pixel manifest and cannot be restored safely.`,
    });
  } else if (snapshot.pixelState === 'complete' && validDimensions && !integrity.complete) {
    blockers.push({
      code: integrity.selectionComplete ? 'snapshot-integrity-unproven' : 'snapshot-selection-unavailable',
      severity: 'error',
      snapshotId: snapshot.id,
      message: `Snapshot ${snapshot.id} does not match its stored pixel/selection content digest manifest.`,
    });
  }

  if (snapshot.layers.length === 0) {
    warnings.push({
      code: 'empty-snapshot-layers',
      severity: 'warning',
      snapshotId: snapshot.id,
      message: `Snapshot ${snapshot.id} contains no layer records.`,
    });
  }

  const restorable = blockers.length === 0;
  const signaturePayload = {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt ?? null,
    width: snapshot.width,
    height: snapshot.height,
    layerCount: snapshot.layers.length,
    activeLayerId: snapshot.activeLayerId,
    hasSelection: snapshot.hasSelection,
    selectionVersion: snapshot.selectionVersion,
    restorable,
    blockerCodes: blockers.map((blocker) => blocker.code),
    warningCodes: warnings.map((warning) => warning.code),
  };

  return {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt ?? null,
    width: snapshot.width,
    height: snapshot.height,
    layerCount: snapshot.layers.length,
    activeLayerId: snapshot.activeLayerId,
    hasSelection: snapshot.hasSelection,
    selectionVersion: snapshot.selectionVersion,
    restorable,
    blockers,
    warnings,
    previewSignature: `image-history-snapshot:v1:${JSON.stringify(signaturePayload)}`,
  };
}

function buildSnapshotRenameReadiness(
  doc: ImageDocument,
  rename?: {
    snapshotId?: string | null;
    draftName?: string;
  },
): ImageSnapshotRenameReadiness {
  const targetSnapshotId = rename?.snapshotId ?? null;
  const target = targetSnapshotId
    ? (doc.snapshots ?? []).find((snapshot) => snapshot.id === targetSnapshotId) ?? null
    : null;
  const draftName = compactSnapshotName(rename?.draftName ?? '');
  const blockers: ImageSnapshotReadinessIssue[] = [];
  const warnings: ImageSnapshotReadinessIssue[] = [];

  if (rename && !target) {
    blockers.push({
      code: 'missing-snapshot',
      severity: 'error',
      snapshotId: targetSnapshotId ?? undefined,
      message: targetSnapshotId
        ? `Snapshot ${targetSnapshotId} does not exist.`
        : 'No snapshot is selected for rename.',
    });
  }

  if (rename && draftName.length === 0) {
    blockers.push({
      code: 'blank-snapshot-name',
      severity: 'error',
      snapshotId: targetSnapshotId ?? undefined,
      message: 'Snapshot rename requires a non-empty name.',
    });
  }

  const unchanged = Boolean(target && draftName === target.name);
  if (rename && unchanged) {
    warnings.push({
      code: 'unchanged-snapshot-name',
      severity: 'warning',
      snapshotId: targetSnapshotId ?? undefined,
      message: `Snapshot ${targetSnapshotId ?? ''} already uses this name.`,
    });
  }

  const supported = Boolean(target && draftName.length > 0);
  const willUpdate = supported && !unchanged && blockers.length === 0;
  const signaturePayload = {
    snapshotId: targetSnapshotId,
    targetExists: Boolean(target),
    currentName: target?.name ?? null,
    draftName,
    willUpdate,
    blockerCodes: blockers.map((blocker) => blocker.code),
    warningCodes: warnings.map((warning) => warning.code),
  };

  return {
    supported,
    targetSnapshotId,
    targetExists: Boolean(target),
    currentName: target?.name ?? null,
    draftName,
    unchanged,
    willUpdate,
    blockers,
    warnings,
    signature: `image-history-snapshot-rename:v1:${JSON.stringify(signaturePayload)}`,
  };
}

export function buildImageSnapshotReadinessDescriptor(input: {
  doc: ImageDocument;
  rename?: {
    snapshotId?: string | null;
    draftName?: string;
  };
}): ImageSnapshotReadinessDescriptor {
  const snapshots = input.doc.snapshots ?? [];
  const namedSnapshots = snapshots.map(buildNamedSnapshotReadiness);
  const capacityWarning: ImageSnapshotReadinessIssue[] = snapshots.length >= IMAGE_DOCUMENT_MAX_SNAPSHOTS
    ? [{
      code: 'snapshot-limit-reached',
      severity: 'warning',
      message: `Only the most recent ${IMAGE_DOCUMENT_MAX_SNAPSHOTS} Image snapshots are retained.`,
    }]
    : [];
  const rename = buildSnapshotRenameReadiness(input.doc, input.rename);
  const blockers = [
    ...namedSnapshots.flatMap((snapshot) => snapshot.blockers),
    ...rename.blockers,
  ];
  const warnings = [
    ...namedSnapshots.flatMap((snapshot) => snapshot.warnings),
    ...capacityWarning,
    ...rename.warnings,
  ];
  const snapshotSignatures = namedSnapshots.map((snapshot) => snapshot.previewSignature);
  const namedSnapshotSignaturePayload = {
    documentId: input.doc.id,
    snapshotSignatures,
  };
  const previewSignaturePayload = {
    document: {
      id: input.doc.id,
      width: input.doc.width,
      height: input.doc.height,
      layerCount: input.doc.layers.length,
      activeLayerId: input.doc.activeLayerId,
      hasSelection: input.doc.hasSelection,
    },
    snapshotSignatures,
    renameSignature: rename.signature,
    blockerCodes: blockers.map((blocker) => blocker.code),
    warningCodes: warnings.map((warning) => warning.code),
  };

  return {
    descriptorId: 'image-history-snapshots-readiness:v1',
    document: {
      id: input.doc.id,
      title: input.doc.title,
      width: input.doc.width,
      height: input.doc.height,
      layerCount: input.doc.layers.length,
      activeLayerId: input.doc.activeLayerId,
      hasSelection: input.doc.hasSelection,
      dirty: input.doc.dirty,
    },
    capacity: {
      maxSnapshots: IMAGE_DOCUMENT_MAX_SNAPSHOTS,
      count: snapshots.length,
      remaining: Math.max(0, IMAGE_DOCUMENT_MAX_SNAPSHOTS - snapshots.length),
      canCreate: snapshots.length < IMAGE_DOCUMENT_MAX_SNAPSHOTS,
    },
    namedSnapshots: {
      count: namedSnapshots.length,
      hasNamedSnapshots: namedSnapshots.length > 0,
      snapshots: namedSnapshots,
      signature: `image-history-named-snapshots:v1:${JSON.stringify(namedSnapshotSignaturePayload)}`,
    },
    rename,
    automationMetadata: {
      workspaceId: 'image-automation',
      separateFromMainFlow: true,
      bindingReadiness: 'ready-for-review',
      supportsNamedSnapshotVariables: true,
      supportsArbitraryJsExpressions: false,
      snapshotVariableTargets: namedSnapshots.filter((snapshot) => snapshot.restorable).map((snapshot) => snapshot.id),
    },
    blockers,
    warnings,
    preview: {
      id: `image-history-snapshots-preview:${input.doc.id}:${namedSnapshots.length}-snapshots:${blockers.length}-blockers`,
      signature: `image-history-snapshots-readiness:v1:${JSON.stringify(previewSignaturePayload)}`,
    },
  };
}

export function deleteImageDocumentSnapshot(
  doc: ImageDocument,
  snapshotId: string,
  options: { deferDisposal?: boolean } = {},
): ImageDocument {
  const next = {
    ...doc,
    snapshots: (doc.snapshots ?? []).filter((snapshot) => snapshot.id !== snapshotId),
    dirty: true,
  };
  if (!options.deferDisposal) disposeImageDocumentSnapshotsRemoved(doc, next);
  return next;
}

export function renameImageDocumentSnapshot(
  doc: ImageDocument,
  snapshotId: string,
  name: string,
  updatedAt = Date.now(),
): ImageDocument {
  const normalizedName = normalizeSnapshotName(name, doc);
  if (!name.trim()) return doc;
  let changed = false;
  const snapshots = (doc.snapshots ?? []).map((snapshot) => {
    if (snapshot.id !== snapshotId || snapshot.name === normalizedName) return snapshot;
    changed = true;
    const renamed = {
      ...snapshot,
      name: normalizedName,
      updatedAt,
    };
    if (ownedNamedSnapshots.has(snapshot)) ownedNamedSnapshots.add(renamed);
    const verified = verifiedNamedSnapshots.get(snapshot);
    if (verified && verifiedBindingMatches(snapshot, verified)) {
      verifiedNamedSnapshots.set(renamed, captureVerifiedBinding(renamed, verified.result));
    }
    return renamed;
  });
  return changed ? { ...doc, snapshots, dirty: true } : doc;
}

function normalizeSnapshotName(name: string, doc: ImageDocument): string {
  const normalized = compactSnapshotName(name);
  return normalized.length > 0 ? normalized : `Snapshot ${(doc.snapshots?.length ?? 0) + 1}`;
}
