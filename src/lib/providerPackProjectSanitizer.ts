import type { AppNode } from '../types/flow';
import type {
  EmbeddedProviderPackSnapshotV1,
  ModelCardRefV1,
} from './providerPackContracts';
import { hashProviderPack } from './providerPackPortability';
import { parseProviderPackText } from './providerPackValidation';

export const PROJECT_PROVIDER_PACK_LIMIT = 50;

export function sanitizeEmbeddedProviderPackSnapshots(
  value: unknown,
): EmbeddedProviderPackSnapshotV1[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output: EmbeddedProviderPackSnapshotV1[] = [];
  for (const candidate of value.slice(0, PROJECT_PROVIDER_PACK_LIMIT)) {
    if (!isRecord(candidate) || candidate.schemaVersion !== 1 || !isRecord(candidate.pack)) continue;
    try {
      const pack = parseProviderPackText(JSON.stringify(candidate.pack));
      const contentHash = hashProviderPack(pack);
      const referencedCardIds = Array.isArray(candidate.referencedCardIds)
        ? candidate.referencedCardIds.filter((id): id is string =>
            typeof id === 'string' && pack.cards.some((card) => card.id === id)
          )
        : [];
      if (
        typeof candidate.hash !== 'string'
        || !referencedCardIds.length
        || (
          typeof candidate.contentHash === 'string'
            ? candidate.contentHash !== contentHash
            : candidate.hash !== contentHash
        )
      ) continue;
      output.push({
        schemaVersion: 1,
        pack,
        hash: candidate.hash,
        contentHash,
        referencedCardIds,
      });
    } catch {
      // Invalid embedded packs remain unavailable rather than compromising project open.
    }
  }
  return output.length ? output : undefined;
}

export function attachProjectSnapshotsToModelCardNodes(
  nodes: readonly AppNode[],
  snapshots: readonly EmbeddedProviderPackSnapshotV1[] | undefined,
): AppNode[] {
  if (!snapshots?.length) return [...nodes];
  return nodes.map((node) => {
    const ref = parseProjectModelCardRef(node.data.modelCardRef);
    if (!ref) return node;
    const snapshot = snapshots.find((candidate) =>
      candidate.pack.packId === ref.packId
      && candidate.hash === ref.hash
      && candidate.referencedCardIds.includes(ref.cardId)
    );
    return snapshot
      ? { ...node, data: { ...node.data, embeddedProviderPackSnapshots: [snapshot] } }
      : node;
  });
}

export function parseProjectModelCardRef(value: unknown): ModelCardRefV1 | undefined {
  return isRecord(value)
    && typeof value.packId === 'string'
    && typeof value.version === 'string'
    && typeof value.hash === 'string'
    && typeof value.cardId === 'string'
    ? value as unknown as ModelCardRefV1
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
