import { BUNDLED_PROVIDER_PACKS, getBundledProviderPack } from './bundledProviderPacks';
import {
  type EmbeddedProviderPackSnapshotV1,
  type FlowModelCardV1,
  type LocalCredentialRecordV1,
  type ModelCardRefV1,
  type PersonalModelCardLayoutV1,
  type ProviderPackDraftV1,
  type ProviderPackRuntimeRecord,
  type ProviderPackReleasePolicyV1,
  type ProviderPackSettingsBackupV1,
  type ProviderPackV1,
} from './providerPackContracts';
import {
  compareProviderPacks,
  hashProviderPack,
  importProviderPack,
} from './providerPackPortability';
import { encryptSecret, decryptSecret } from './secretCipher';
import { validateProviderPack } from './providerPackValidation';
import {
  sanitizePresentationOverride,
  sanitizeProviderPackSettingsBackup,
} from './providerPackBackup';

export { sanitizeProviderPackSettingsBackup } from './providerPackBackup';

const DB_NAME = 'sloom-provider-packs';
const DB_VERSION = 1;
const STORES = {
  packs: 'packs',
  drafts: 'drafts',
  layouts: 'layouts',
  credentials: 'credentials',
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

interface StoredPackRecord extends ProviderPackRuntimeRecord {
  storageKey: string;
}

export interface ResolvedModelCard {
  pack: ProviderPackV1;
  card: FlowModelCardV1;
  hash: string;
  source: 'installed-exact' | 'project-embedded' | 'missing';
  executable: boolean;
  missingReason?: string;
}

class ProviderPackRegistry {
  private readonly bundled = new Map<string, ProviderPackRuntimeRecord>();
  private readonly installed = new Map<string, StoredPackRecord>();
  private readonly drafts = new Map<string, ProviderPackDraftV1>();
  private readonly layouts = new Map<string, PersonalModelCardLayoutV1>();
  private readonly credentials = new Map<string, LocalCredentialRecordV1>();
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private releasePolicy?: ProviderPackReleasePolicyV1;
  private revision = 0;

  constructor() {
    for (const pack of BUNDLED_PROVIDER_PACKS) {
      const hash = hashProviderPack(pack);
      this.bundled.set(pack.packId, {
        pack,
        hash,
        provenance: 'bundled',
        importedAt: 0,
        active: true,
        executionApproved: true,
        sourceLabel: 'Bundled recovery copy',
        trustApprovedOrigins: pack.approvedOrigins.map((entry) => entry.origin),
        testStatusByOperation: Object.fromEntries(
          pack.cards.flatMap((card) => card.operations.map((operation) => [`${card.id}:${operation.id}`, 'untested' as const])),
        ),
      });
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.revision;

  setReleasePolicy(policy?: ProviderPackReleasePolicyV1): void {
    this.releasePolicy = policy ? structuredCloneSafe(policy) : undefined;
    this.emit();
  }

  getReleasePolicy(): ProviderPackReleasePolicyV1 | undefined {
    return this.releasePolicy ? structuredCloneSafe(this.releasePolicy) : undefined;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      if (hasIndexedDb()) {
        const [packs, drafts, layouts, credentials] = await Promise.all([
          readAll<StoredPackRecord>(STORES.packs),
          readAll<ProviderPackDraftV1>(STORES.drafts),
          readAll<PersonalModelCardLayoutV1>(STORES.layouts),
          readAll<LocalCredentialRecordV1>(STORES.credentials),
        ]).catch(() => [[], [], [], []] as const);
        for (const record of packs) {
          if (validateProviderPack(record.pack, { provenance: record.provenance }).validStructure) {
            this.installed.set(record.storageKey, {
              ...record,
              executionApproved: record.executionApproved ?? record.active,
            });
          }
        }
        for (const draft of drafts) this.drafts.set(draft.id, draft);
        for (const layout of layouts) this.layouts.set(layoutKey(layout.packId, layout.cardId), layout);
        for (const credential of credentials) this.credentials.set(credentialKey(credential.packId, credential.slotId), credential);
      }
      this.initialized = true;
      this.initializing = null;
      this.emit();
    })();
    return this.initializing;
  }

  listRecords(): ProviderPackRuntimeRecord[] {
    const output: ProviderPackRuntimeRecord[] = [];
    for (const bundled of this.bundled.values()) {
      output.push({
        ...bundled,
        active: ![...this.installed.values()].some((record) => record.pack.packId === bundled.pack.packId && record.active),
      });
    }
    output.push(...[...this.installed.values()].sort((a, b) => b.importedAt - a.importedAt));
    return output;
  }

  listDrafts(): ProviderPackDraftV1[] {
    return [...this.drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getActiveRecord(packId: string): ProviderPackRuntimeRecord | undefined {
    const override = [...this.installed.values()]
      .filter((record) => record.pack.packId === packId && record.active)
      .sort((a, b) => b.importedAt - a.importedAt)[0];
    return override ?? this.bundled.get(packId);
  }

  getRecordByHash(packId: string, hash: string): ProviderPackRuntimeRecord | undefined {
    const bundled = this.bundled.get(packId);
    if (bundled?.hash === hash) return bundled;
    return [...this.installed.values()].find((record) => record.pack.packId === packId && record.hash === hash);
  }

  async importText(
    text: string,
    input: {
      provenance?: 'local' | 'community' | 'project-embedded';
      sourceLabel?: string;
      approveOrigins?: boolean;
      activate?: boolean;
    } = {},
  ): Promise<{
    record: ProviderPackRuntimeRecord;
    differences: ReturnType<typeof compareProviderPacks>;
  }> {
    await this.initialize();
    const { pack, hash } = importProviderPack(text);
    const provenance = input.provenance ?? 'local';
    const validation = validateProviderPack(pack, { provenance });
    const activeBefore = this.getActiveRecord(pack.packId);
    const record: StoredPackRecord = {
      storageKey: storageKey(pack.packId, hash),
      pack,
      hash,
      provenance,
      importedAt: Date.now(),
      active: Boolean(input.activate && validation.activatable),
      executionApproved: Boolean(input.activate && validation.activatable),
      sourceLabel: input.sourceLabel,
      trustApprovedOrigins: input.approveOrigins ? pack.approvedOrigins.map((entry) => entry.origin) : [],
      testStatusByOperation: Object.fromEntries(
        pack.cards.flatMap((card) => card.operations.map((operation) => [`${card.id}:${operation.id}`, 'untested' as const])),
      ),
    };
    if (record.active) this.deactivatePackRecords(pack.packId);
    this.installed.set(record.storageKey, record);
    await writeStore(STORES.packs, record, record.storageKey);
    this.emit();
    return {
      record,
      differences: activeBefore ? compareProviderPacks(activeBefore.pack, pack) : [],
    };
  }

  async activate(packId: string, hash: string): Promise<void> {
    await this.initialize();
    const record = this.installed.get(storageKey(packId, hash));
    if (!record) throw new Error('Imported provider pack was not found.');
    const validation = validateProviderPack(record.pack, { provenance: record.provenance });
    if (!validation.activatable) {
      throw new Error(
        validation.issues.find((issue) => issue.severity === 'blocking')?.message
          ?? 'Provider pack cannot be activated.',
      );
    }
    this.deactivatePackRecords(packId);
    record.active = true;
    record.executionApproved = true;
    await this.persistPackGroup(packId);
    this.emit();
  }

  async approveOrigins(packId: string, hash: string, origins: string[]): Promise<void> {
    await this.initialize();
    const record = this.installed.get(storageKey(packId, hash));
    if (!record) throw new Error('Imported provider pack was not found.');
    const declared = new Set(record.pack.approvedOrigins.map((entry) => entry.origin));
    record.trustApprovedOrigins = origins.filter((origin) => declared.has(origin));
    await writeStore(STORES.packs, record, record.storageKey);
    this.emit();
  }

  async restoreBundled(packId: string): Promise<void> {
    await this.initialize();
    if (!getBundledProviderPack(packId)) throw new Error('This provider has no bundled recovery copy.');
    this.deactivatePackRecords(packId);
    await this.persistPackGroup(packId);
    this.emit();
  }

  async removeOverride(packId: string, hash: string): Promise<void> {
    await this.initialize();
    const key = storageKey(packId, hash);
    this.installed.delete(key);
    await deleteStore(STORES.packs, key);
    this.emit();
  }

  resolveCard(
    ref: ModelCardRefV1,
    embedded: readonly EmbeddedProviderPackSnapshotV1[] = [],
  ): ResolvedModelCard {
    const exact = this.getRecordByHash(ref.packId, ref.hash);
    const exactCard = exact?.pack.cards.find((card) => card.id === ref.cardId);
    if (exact && exactCard) {
      const policyReason = this.executionPolicyReason(exact.pack, exactCard);
      const executable = exact.executionApproved === true && this.canExecute(exact) && !policyReason;
      return {
        pack: exact.pack,
        card: exactCard,
        hash: exact.hash,
        source: 'installed-exact',
        executable,
        missingReason: executable
          ? undefined
          : policyReason
            ? policyReason
            : exact.executionApproved
              ? 'Approve this pack’s exact origins and provide its local credential slots before running.'
            : 'Review and activate this imported provider-pack version before running.',
      };
    }
    const snapshot = embedded.find((candidate) => candidate.hash === ref.hash && candidate.pack.packId === ref.packId);
    const snapshotCard = snapshot?.pack.cards.find((card) => card.id === ref.cardId);
    if (snapshot && snapshotCard) {
      return {
        pack: snapshot.pack,
        card: snapshotCard,
        hash: snapshot.hash,
        source: 'project-embedded',
        executable: false,
        missingReason: 'Project-embedded packs render safely, but this device must approve origins and configure credentials before execution.',
      };
    }
    return {
      pack: {
        schemaVersion: 1,
        packId: ref.packId,
        version: ref.version,
        displayName: 'Missing provider pack',
        provider: { name: 'Missing provider' },
        approvedOrigins: [],
        credentialSlots: [],
        discovery: [],
        optionCatalogs: [],
        transports: [],
        cards: [],
      },
      card: missingCard(ref.cardId),
      hash: ref.hash,
      source: 'missing',
      executable: false,
      missingReason: 'Install the exact provider-pack hash or reopen the project with its embedded snapshot.',
    };
  }

  async saveDraft(id: string, pack: ProviderPackV1): Promise<ProviderPackDraftV1> {
    await this.initialize();
    const previous = this.drafts.get(id);
    const now = Date.now();
    const draft: ProviderPackDraftV1 = {
      schemaVersion: 1,
      id,
      pack,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      revision: (previous?.revision ?? 0) + 1,
    };
    this.drafts.set(id, draft);
    await writeStore(STORES.drafts, draft, id);
    this.emit();
    return draft;
  }

  async savePersonalLayout(layout: PersonalModelCardLayoutV1): Promise<void> {
    await this.initialize();
    const record = this.getRecordByHash(layout.packId, layout.packHash);
    const card = record?.pack.cards.find((candidate) => candidate.id === layout.cardId);
    if (!record || !card) throw new Error('Personal layout must reference an installed card and exact pack hash.');
    const safeLayout: PersonalModelCardLayoutV1 = {
      schemaVersion: 1,
      packId: record.pack.packId,
      cardId: card.id,
      packHash: record.hash,
      override: sanitizePresentationOverride(layout.override, card),
      updatedAt: Number.isFinite(layout.updatedAt) && layout.updatedAt > 0 ? layout.updatedAt : Date.now(),
    };
    this.layouts.set(layoutKey(safeLayout.packId, safeLayout.cardId), safeLayout);
    await writeStore(STORES.layouts, safeLayout, layoutKey(safeLayout.packId, safeLayout.cardId));
    this.emit();
  }

  getPersonalLayout(packId: string, cardId: string): PersonalModelCardLayoutV1 | undefined {
    return this.layouts.get(layoutKey(packId, cardId));
  }

  async setCredential(packId: string, slotId: string, value: string): Promise<void> {
    await this.initialize();
    const selected = this.getActiveRecord(packId)
      ?? [...this.installed.values()]
        .filter((record) => record.pack.packId === packId)
        .sort((left, right) => right.importedAt - left.importedAt)[0];
    const slot = selected?.pack.credentialSlots.find((candidate) => candidate.id === slotId);
    if (!selected || !slot) throw new Error('Credential slot was not found in this provider pack.');
    if (!value.trim()) {
      this.credentials.delete(credentialKey(packId, slotId));
      await deleteStore(STORES.credentials, credentialKey(packId, slotId));
      this.emit();
      return;
    }
    const record: LocalCredentialRecordV1 = {
      schemaVersion: 1,
      packId,
      slotId,
      approvedOrigin: slot.approvedOrigin,
      encryptedValue: await encryptSecret(value.trim()),
      updatedAt: Date.now(),
    };
    this.credentials.set(credentialKey(packId, slotId), record);
    await writeStore(STORES.credentials, record, credentialKey(packId, slotId));
    this.emit();
  }

  async getCredential(packId: string, slotId: string, approvedOrigin?: string): Promise<string | null> {
    await this.initialize();
    const record = this.credentials.get(credentialKey(packId, slotId));
    const slotExists = this.listRecords().some((candidate) =>
      candidate.pack.packId === packId
      && candidate.pack.credentialSlots.some((slot) =>
        slot.id === slotId
        && slot.approvedOrigin === record?.approvedOrigin
        && (!approvedOrigin || slot.approvedOrigin === approvedOrigin)
      )
    );
    if (!record || !slotExists || (approvedOrigin && record.approvedOrigin !== approvedOrigin)) return null;
    return decryptSecret(record.encryptedValue);
  }

  hasCredential(packId: string, slotId: string): boolean {
    const active = this.getActiveRecord(packId);
    const slot = active?.pack.credentialSlots.find((candidate) => candidate.id === slotId);
    const record = this.credentials.get(credentialKey(packId, slotId));
    return Boolean(slot && record && slot.approvedOrigin === record.approvedOrigin);
  }

  async setOperationTestStatus(
    packId: string,
    hash: string,
    cardId: string,
    operationId: string,
    status: 'untested' | 'passed' | 'failed',
  ): Promise<void> {
    await this.initialize();
    const record = this.installed.get(storageKey(packId, hash));
    if (!record) return;
    record.testStatusByOperation[`${cardId}:${operationId}`] = status;
    await writeStore(STORES.packs, record, record.storageKey);
    this.emit();
  }

  async exportSettingsBackup(): Promise<ProviderPackSettingsBackupV1 | undefined> {
    await this.initialize();
    const credentials = await Promise.all([...this.credentials.values()].map(async (record) => ({
      packId: record.packId,
      slotId: record.slotId,
      approvedOrigin: record.approvedOrigin,
      value: await decryptSecret(record.encryptedValue),
    })));
    const backup: ProviderPackSettingsBackupV1 = {
      schemaVersion: 1,
      packs: [...this.installed.values()].slice(0, 512).map((record) => ({
        pack: record.pack,
        sourceLabel: record.sourceLabel,
      })),
      drafts: this.listDrafts().slice(0, 512),
      personalLayouts: [...this.layouts.values()].slice(0, 5_000),
      credentials: credentials.flatMap((record) =>
        record.value ? [{ ...record, value: record.value }] : []
      ).slice(0, 512),
    };
    return backup.packs.length || backup.drafts.length || backup.personalLayouts.length || backup.credentials.length
      ? backup
      : undefined;
  }

  async importSettingsBackup(value: unknown): Promise<void> {
    const backup = sanitizeProviderPackSettingsBackup(value);
    await this.initialize();
    for (const entry of backup.packs) {
      const serialized = JSON.stringify(entry.pack);
      await this.importText(serialized, {
        provenance: 'local',
        sourceLabel: entry.sourceLabel ?? 'Encrypted settings backup',
        approveOrigins: false,
        activate: false,
      });
    }
    for (const draft of backup.drafts) {
      await this.saveDraft(draft.id, draft.pack);
    }
    for (const layout of backup.personalLayouts) {
      const installed = this.getRecordByHash(layout.packId, layout.packHash);
      if (!installed?.pack.cards.some((card) => card.id === layout.cardId)) continue;
      await this.savePersonalLayout(layout);
    }
    for (const credential of backup.credentials) {
      const candidates = this.listRecords().filter((record) =>
        record.pack.packId === credential.packId
        && record.pack.credentialSlots.some((slot) =>
          slot.id === credential.slotId && slot.approvedOrigin === credential.approvedOrigin
        )
      );
      if (!candidates.length) continue;
      const restored: LocalCredentialRecordV1 = {
        schemaVersion: 1,
        packId: credential.packId,
        slotId: credential.slotId,
        approvedOrigin: credential.approvedOrigin,
        encryptedValue: await encryptSecret(credential.value.trim()),
        updatedAt: Date.now(),
      };
      const key = credentialKey(restored.packId, restored.slotId);
      this.credentials.set(key, restored);
      await writeStore(STORES.credentials, restored, key);
    }
    this.emit();
  }

  assertExecutionAllowed(
    pack: ProviderPackV1,
    card: FlowModelCardV1,
    operationId: string,
    values: Record<string, unknown>,
  ): void {
    const reason = this.executionPolicyReason(pack, card, operationId, values);
    if (reason) throw new Error(reason);
  }

  private canExecute(record: ProviderPackRuntimeRecord): boolean {
    const declaredOrigins = record.pack.approvedOrigins.map((entry) => entry.origin);
    return declaredOrigins.every((origin) => record.trustApprovedOrigins.includes(origin))
      && record.pack.credentialSlots.every((slot) => !slot.required || this.hasCredential(record.pack.packId, slot.id));
  }

  private executionPolicyReason(
    pack: ProviderPackV1,
    card: FlowModelCardV1,
    operationId?: string,
    values: Record<string, unknown> = {},
  ): string | undefined {
    const policy = this.releasePolicy;
    if (!policy) return undefined;
    if (policy.lockedPackIds?.includes(pack.packId)) {
      return `${pack.displayName} is disabled by this Sloom release policy.`;
    }
    if (policy.lockedCardIds?.includes(card.id)) {
      return `${card.displayName} is disabled by this Sloom release policy.`;
    }
    if (operationId && policy.lockedOperationIds?.includes(operationId)) {
      return `${operationId} is disabled by this Sloom release policy.`;
    }
    const allowedOrigins = new Set(policy.allowedApprovedOrigins ?? []);
    if (
      allowedOrigins.size > 0
      && pack.approvedOrigins.some((origin) => !allowedOrigins.has(origin.origin))
    ) {
      return `${card.displayName} uses an origin that is not allowed by this Sloom release policy.`;
    }
    for (const [fieldId, forbiddenValues] of Object.entries(policy.lockedValues ?? {})) {
      if (forbiddenValues.some((value) => Object.is(value, values[fieldId]))) {
        return `${fieldId} uses a value disabled by this Sloom release policy.`;
      }
    }
    return undefined;
  }

  private deactivatePackRecords(packId: string): void {
    for (const record of this.installed.values()) {
      if (record.pack.packId === packId) record.active = false;
    }
  }

  private async persistPackGroup(packId: string): Promise<void> {
    await Promise.all(
      [...this.installed.values()]
        .filter((record) => record.pack.packId === packId)
        .map((record) => writeStore(STORES.packs, record, record.storageKey)),
    );
  }

  private emit(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

export const providerPackRegistry = new ProviderPackRegistry();

export function initializeProviderPackRegistry(): Promise<void> {
  return providerPackRegistry.initialize();
}

export function configureProviderPackReleasePolicy(policy?: ProviderPackReleasePolicyV1): void {
  providerPackRegistry.setReleasePolicy(policy);
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function structuredCloneSafe<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

let databasePromise: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of Object.values(STORES)) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Provider-pack IndexedDB open failed.'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise!;
}

async function readAll<T>(storeName: StoreName): Promise<T[]> {
  if (!hasIndexedDb()) return [];
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

async function writeStore(storeName: StoreName, value: unknown, key: IDBValidKey): Promise<void> {
  if (!hasIndexedDb()) return;
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  await requestResult(transaction.objectStore(storeName).put(value, key));
}

async function deleteStore(storeName: StoreName, key: IDBValidKey): Promise<void> {
  if (!hasIndexedDb()) return;
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  await requestResult(transaction.objectStore(storeName).delete(key));
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Provider-pack IndexedDB request failed.'));
  });
}

function storageKey(packId: string, hash: string): string {
  return `${packId}@${hash}`;
}

function layoutKey(packId: string, cardId: string): string {
  return `${packId}\u0000${cardId}`;
}

function credentialKey(packId: string, slotId: string): string {
  return `${packId}\u0000${slotId}`;
}

function missingCard(cardId: string): FlowModelCardV1 {
  return {
    schemaVersion: 1,
    id: cardId,
    modelId: 'missing',
    displayName: 'Missing model card',
    modalities: [],
    fields: [],
    outputs: [],
    operations: [],
    evidence: [],
    confidence: 'untested',
    status: 'draft',
    layout: {
      schemaVersion: 1,
      id: 'missing',
      width: 390,
      minWidth: 260,
      maxWidth: 1_040,
      fitTarget: '1080p',
      heightBudget: 900,
      containers: [],
      elements: [],
    },
  };
}
