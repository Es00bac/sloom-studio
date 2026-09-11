import type {
  ProviderPackProvenance,
  ProviderPackReleasePolicyV1,
  ProviderPackRuntimeRecord,
  ProviderPackValidationResult,
  ProviderPackV1,
} from './providerPackContracts';
import { validateProviderPack } from './providerPackValidation';

/** The only extension kind intentionally supported by this bounded SDK surface. */
export const PROVIDER_PACK_EXTENSION_KIND = 'declarative-provider-pack' as const;

export type ProviderPackExtensionReadiness = 'ready' | 'review' | 'blocked';

export interface ProviderPackExtensionReport {
  kind: typeof PROVIDER_PACK_EXTENSION_KIND;
  schemaVersion: 1;
  packId: string;
  version: string;
  displayName: string;
  provenance: ProviderPackRuntimeRecord['provenance'];
  readiness: ProviderPackExtensionReadiness;
  cardCount: number;
  operationCount: number;
  transportKinds: string[];
  approvedOrigins: string[];
  requiredCredentialSlotCount: number;
  discoveryRecipeCount: number;
  credentialMaterial: 'local-slots-only';
  arbitraryCode: false;
  validationIssueCount: number;
  executionApproved: boolean;
  supersession: 'active' | 'inactive' | 'superseded';
  releasePolicy: 'not-configured' | 'allowed' | 'restricted';
  readinessReasons: string[];
}

export interface ProviderPackExtensionInspectionOptions {
  isCredentialConfigured?: (slotId: string) => boolean;
  /** The same release policy used by the request broker; it never grants authority here. */
  releasePolicy?: ProviderPackReleasePolicyV1;
  /** True when a different active record for this pack ID supersedes this record in the registry. */
  isSuperseded?: boolean;
}

/**
 * Summarize the executable boundary of one provider-pack extension.
 *
 * This is deliberately derived from the same validator and registry state used
 * for execution. It reports what the pack can do without granting it a plugin
 * runtime: packs remain declarative JSON, credentials remain local slots, and
 * request destinations remain the exact approved origins in the pack.
 */
export function inspectProviderPackExtension(
  record: ProviderPackRuntimeRecord,
  options: ProviderPackExtensionInspectionOptions = {},
): ProviderPackExtensionReport {
  const rawRecord = asRecord(record);
  const rawPack = rawRecord?.pack;
  const provenance = providerPackProvenance(rawRecord?.provenance);
  const recordShapeValid = rawRecord !== undefined && provenance !== undefined
    && typeof rawRecord.hash === 'string'
    && typeof rawRecord.importedAt === 'number'
    && typeof rawRecord.active === 'boolean'
    && (rawRecord.executionApproved === undefined || typeof rawRecord.executionApproved === 'boolean')
    && Array.isArray(rawRecord.trustApprovedOrigins)
    && rawRecord.trustApprovedOrigins.every((origin) => typeof origin === 'string')
    && asRecord(rawRecord.testStatusByOperation) !== undefined;
  const validation = validateProviderPackSafely(rawPack, {
    provenance: provenance ?? 'local',
    releasePolicy: options.releasePolicy,
  });
  const pack = validation.validStructure && recordShapeValid && hasInspectablePackShape(rawPack)
    ? rawPack as ProviderPackV1
    : undefined;
  const releaseIssues = validation.issues.filter((issue) => issue.code.startsWith('release-policy-'));
  const releasePolicy = options.releasePolicy
    ? releaseIssues.length > 0 ? 'restricted' : 'allowed'
    : 'not-configured';
  const declaredOrigins = pack?.approvedOrigins.map((entry) => entry.origin).sort() ?? [];
  const trustApprovedOrigins = recordShapeValid ? rawRecord.trustApprovedOrigins as string[] : [];
  const originsApproved = pack !== undefined && declaredOrigins.every((origin) => trustApprovedOrigins.includes(origin));
  const requiredCredentials = pack?.credentialSlots.filter((slot) => slot.required) ?? [];
  const credentialsConfigured = pack !== undefined
    && requiredCredentials.every((slot) => options.isCredentialConfigured?.(slot.id) === true);
  const active = rawRecord?.active === true;
  const executionApproved = rawRecord?.executionApproved === true;
  const supersession = options.isSuperseded === true ? 'superseded' : active ? 'active' : 'inactive';
  const readinessReasons = [
    ...(pack === undefined ? ['invalid record or pack structure'] : []),
    ...(!active ? ['not active'] : []),
    ...(options.isSuperseded === true ? ['superseded by another active version'] : []),
    ...(!executionApproved ? ['execution not approved'] : []),
    ...(!originsApproved ? ['approved origins are not trusted'] : []),
    ...(!credentialsConfigured && requiredCredentials.length > 0 ? ['required local credentials are missing'] : []),
    ...(releasePolicy === 'restricted' ? ['restricted by release policy'] : []),
  ];
  const readiness: ProviderPackExtensionReadiness = pack === undefined
    ? 'blocked'
    : readinessReasons.length === 0
      ? 'ready'
      : 'review';

  return {
    kind: PROVIDER_PACK_EXTENSION_KIND,
    schemaVersion: 1,
    packId: pack?.packId ?? stringValue(rawRecord?.packId, 'invalid-provider-pack'),
    version: pack?.version ?? stringValue(rawRecord?.version, '0.0.0'),
    displayName: pack?.displayName ?? 'Invalid provider pack',
    provenance: provenance ?? 'local',
    readiness,
    cardCount: pack?.cards.length ?? 0,
    operationCount: pack?.cards.reduce((total, card) => total + card.operations.length, 0) ?? 0,
    transportKinds: [...new Set(pack?.transports.map((transport) => transport.kind) ?? [])].sort(),
    approvedOrigins: declaredOrigins,
    requiredCredentialSlotCount: requiredCredentials.length,
    discoveryRecipeCount: pack?.discovery.length ?? 0,
    credentialMaterial: 'local-slots-only',
    arbitraryCode: false,
    validationIssueCount: validation.issues.length,
    executionApproved,
    supersession,
    releasePolicy,
    readinessReasons,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function providerPackProvenance(value: unknown): ProviderPackProvenance | undefined {
  return value === 'bundled' || value === 'local' || value === 'community' || value === 'project-embedded'
    ? value
    : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function hasInspectablePackShape(value: unknown): value is ProviderPackV1 {
  const pack = asRecord(value);
  return pack !== undefined
    && Array.isArray(pack.approvedOrigins)
    && Array.isArray(pack.credentialSlots)
    && Array.isArray(pack.discovery)
    && Array.isArray(pack.transports)
    && Array.isArray(pack.cards)
    && pack.cards.every((card) => {
      const typedCard = asRecord(card);
      return typedCard !== undefined && Array.isArray(typedCard.operations);
    });
}

function validateProviderPackSafely(
  value: unknown,
  options: { provenance: ProviderPackProvenance; releasePolicy?: ProviderPackReleasePolicyV1 },
): ProviderPackValidationResult {
  try {
    return validateProviderPack(value, options);
  } catch {
    return {
      validStructure: false,
      activatable: false,
      issues: [{
        code: 'inspection-validation',
        severity: 'blocking',
        message: 'Provider pack could not be structurally inspected.',
      }],
    };
  }
}
