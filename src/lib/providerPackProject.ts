import type { AppNode } from '../types/flow';
import type { FlowWorkspaceProjectSnapshot } from './flowProjectWorkspaces';
import {
  type EmbeddedProviderPackSnapshotV1,
  type ModelCardRefV1,
} from './providerPackContracts';
import { createEmbeddedProviderSnapshot } from './providerPackPortability';
import { providerPackRegistry } from './providerPackRegistry';
import {
  parseProjectModelCardRef,
  PROJECT_PROVIDER_PACK_LIMIT,
} from './providerPackProjectSanitizer';

export {
  attachProjectSnapshotsToModelCardNodes,
  sanitizeEmbeddedProviderPackSnapshots,
} from './providerPackProjectSanitizer';

export function collectProjectProviderPackSnapshots(input: {
  nodes: readonly AppNode[];
  flowWorkspaces?: readonly FlowWorkspaceProjectSnapshot[];
}): EmbeddedProviderPackSnapshotV1[] {
  const references = new Map<string, { ref: ModelCardRefV1; cardIds: Set<string> }>();
  const allNodes = [
    ...input.nodes,
    ...(input.flowWorkspaces ?? []).flatMap((workspace) => workspace.flow.nodes),
  ];
  for (const node of allNodes) {
    const ref = parseProjectModelCardRef(node.data.modelCardRef);
    if (!ref) continue;
    const key = `${ref.packId}\u0000${ref.hash}`;
    const entry = references.get(key) ?? { ref, cardIds: new Set<string>() };
    entry.cardIds.add(ref.cardId);
    references.set(key, entry);
  }
  return [...references.values()].slice(0, PROJECT_PROVIDER_PACK_LIMIT).flatMap(({ ref, cardIds }) => {
    const record = providerPackRegistry.getRecordByHash(ref.packId, ref.hash);
    if (!record) return [];
    return [createEmbeddedProviderSnapshot(record.pack, [...cardIds], record.hash)];
  });
}
