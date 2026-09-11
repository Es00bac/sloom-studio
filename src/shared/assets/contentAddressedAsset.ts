import { sha256Hex } from '../crypto/sha256';

export type BinaryAssetId = `sha256:${string}`;

export interface BinaryAssetRef {
  id: BinaryAssetId;
  sha256: string;
  mimeType: string;
  byteLength: number;
  fileName?: string;
}

export interface BinaryAssetRecord {
  ref: BinaryAssetRef;
  bytes: Uint8Array;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function createBinaryAssetRecord(
  bytes: Uint8Array,
  metadata: { mimeType: string; fileName?: string },
): Promise<BinaryAssetRecord> {
  const copy = new Uint8Array(bytes);
  const sha256 = sha256Hex(copy);

  return {
    ref: {
      id: `sha256:${sha256}`,
      sha256,
      mimeType: metadata.mimeType,
      byteLength: copy.byteLength,
      ...(metadata.fileName ? { fileName: metadata.fileName } : {}),
    },
    bytes: copy,
  };
}

export async function verifyBinaryAssetRecord(record: BinaryAssetRecord): Promise<boolean> {
  const rebuilt = await createBinaryAssetRecord(record.bytes, record.ref);
  return rebuilt.ref.id === record.ref.id && rebuilt.ref.byteLength === record.ref.byteLength;
}

export function isBinaryAssetRef(value: unknown): value is BinaryAssetRef {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.sha256 !== 'string'
    || typeof candidate.mimeType !== 'string'
    || typeof candidate.byteLength !== 'number'
  ) {
    return false;
  }

  return candidate.id === `sha256:${candidate.sha256}`
    && SHA256_PATTERN.test(candidate.sha256)
    && candidate.mimeType.length > 0
    && Number.isInteger(candidate.byteLength)
    && candidate.byteLength >= 0
    && (candidate.fileName === undefined || typeof candidate.fileName === 'string');
}
