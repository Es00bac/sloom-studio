import { sha256Hex } from '../shared/crypto/sha256';
import {
  CARD_WIDTH_MAX,
  CARD_WIDTH_MIN,
  PROVIDER_PACK_EXTENSION,
  type CardLayoutContainerV1,
  type CardLayoutElementV1,
  type CardLayoutV1,
  type EmbeddedProviderPackSnapshotV1,
  type FlowModelCardV1,
  type ModelCardLayoutOverrideV1,
  type PersonalModelCardLayoutV1,
  type ProviderPackDifference,
  type ProviderPackV1,
  type ResolvedCardLayoutV1,
} from './providerPackContracts';
import { parseProviderPackText, validateProviderPack } from './providerPackValidation';

export interface SerializedProviderPack {
  fileName: string;
  json: string;
  hash: string;
  bytes: number;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

export function hashProviderPack(pack: ProviderPackV1): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(stripCredentialMaterial(pack))));
}

export function serializeProviderPack(pack: ProviderPackV1): SerializedProviderPack {
  const safePack = stripCredentialMaterial(pack);
  const validation = validateProviderPack(safePack);
  if (!validation.validStructure) {
    throw new Error(
      validation.issues.find((issue) => issue.severity === 'blocking')?.message
        ?? 'Provider pack cannot be exported.',
    );
  }
  const json = `${canonicalJson(safePack)}\n`;
  return {
    fileName: `${fileSafe(pack.packId)}-${fileSafe(pack.version)}${PROVIDER_PACK_EXTENSION}`,
    json,
    hash: hashProviderPack(safePack),
    bytes: new TextEncoder().encode(json).byteLength,
  };
}

export function stripCredentialMaterial(pack: ProviderPackV1): ProviderPackV1 {
  const clone = structuredCloneSafe(pack);
  const visit = (value: unknown, parentKey = ''): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item, parentKey));
    if (!isRecord(value)) return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (
        ['credentialvalue', 'apikey', 'api_key', 'token', 'password', 'secret', 'authorization'].includes(normalized)
        || (parentKey === 'staticHeaders' && /api[-_]?key|token|secret|authorization/i.test(key))
      ) {
        continue;
      }
      output[key] = visit(item, key);
    }
    return output;
  };
  return visit(clone) as ProviderPackV1;
}

export function importProviderPack(text: string): { pack: ProviderPackV1; hash: string } {
  const pack = parseProviderPackText(text);
  return { pack, hash: hashProviderPack(pack) };
}

export function compareProviderPacks(
  before: ProviderPackV1,
  after: ProviderPackV1,
): ProviderPackDifference[] {
  const differences: ProviderPackDifference[] = [];
  diffOrigins(before, after, differences);
  diffCredentials(before, after, differences);
  diffTransports(before, after, differences);
  diffCards(before, after, differences);
  return differences;
}

export function createEmbeddedProviderSnapshot(
  pack: ProviderPackV1,
  referencedCardIds: readonly string[],
  sourcePackHash = hashProviderPack(pack),
): EmbeddedProviderPackSnapshotV1 {
  const wanted = new Set(referencedCardIds);
  const cards = pack.cards.filter((card) => wanted.has(card.id));
  const usedTransportIds = new Set(cards.flatMap((card) => card.operations.map((operation) => operation.transportProfileId)));
  const usedCredentialSlots = new Set(
    pack.transports
      .filter((transport) => usedTransportIds.has(transport.id))
      .map((transport) => transport.credentialSlotId)
      .filter((id): id is string => Boolean(id)),
  );
  const usedOptionCatalogs = new Set(cards.flatMap((card) =>
    card.fields.map((field) => field.optionCatalogId).filter((id): id is string => Boolean(id))
  ));
  const snapshotPack = stripCredentialMaterial({
    ...pack,
    cards,
    transports: pack.transports.filter((transport) => usedTransportIds.has(transport.id)),
    credentialSlots: pack.credentialSlots.filter((slot) => usedCredentialSlots.has(slot.id)),
    optionCatalogs: pack.optionCatalogs.filter((catalog) => usedOptionCatalogs.has(catalog.id)),
  });
  return {
    schemaVersion: 1,
    pack: snapshotPack,
    hash: sourcePackHash,
    contentHash: hashProviderPack(snapshotPack),
    referencedCardIds: cards.map((card) => card.id),
  };
}

export function resolveCardLayout(input: {
  card: FlowModelCardV1;
  nodeOverride?: ModelCardLayoutOverrideV1;
  personal?: PersonalModelCardLayoutV1;
  automatic?: CardLayoutV1;
}): ResolvedCardLayoutV1 {
  if (input.nodeOverride) {
    return { layout: applyLayoutOverride(input.card.layout, input.nodeOverride), source: 'node' };
  }
  if (input.personal) {
    return { layout: applyLayoutOverride(input.card.layout, input.personal.override), source: 'personal' };
  }
  if (input.card.layout) {
    return { layout: structuredCloneSafe(input.card.layout), source: 'pack' };
  }
  if (!input.automatic) throw new Error('No card layout or automatic layout is available.');
  return { layout: structuredCloneSafe(input.automatic), source: 'automatic' };
}

export function applyLayoutOverride(
  base: CardLayoutV1,
  override: ModelCardLayoutOverrideV1,
): CardLayoutV1 {
  const containerOverrides = new Map((override.containers ?? []).map((item) => [item.id, item]));
  const elementOverrides = new Map((override.elements ?? []).map((item) => [item.id, item]));
  const containerIds = new Set(base.containers.map((container) => container.id));
  return {
    ...structuredCloneSafe(base),
    width: clamp(override.width ?? base.width, CARD_WIDTH_MIN, CARD_WIDTH_MAX),
    fitTarget: override.fitTarget ?? base.fitTarget,
    containers: base.containers.map((container) => applyContainerOverride(container, containerOverrides.get(container.id))),
    elements: base.elements.map((element) => applyElementOverride(element, elementOverrides.get(element.id), containerIds)),
    handlePlacements: override.handlePlacements ?? structuredCloneSafe(base.handlePlacements),
  };
}

export function createLayoutOverride(
  cardId: string,
  base: CardLayoutV1,
  edited: CardLayoutV1,
  operationId?: string,
): ModelCardLayoutOverrideV1 {
  return {
    schemaVersion: 1,
    cardId,
    ...(operationId ? { operationId } : {}),
    ...(base.width === edited.width ? {} : { width: edited.width }),
    ...(base.fitTarget === edited.fitTarget ? {} : { fitTarget: edited.fitTarget }),
    ...(presentationEqual(base.handlePlacements, edited.handlePlacements)
      ? {}
      : { handlePlacements: structuredCloneSafe(edited.handlePlacements ?? []) }),
    containers: edited.containers.flatMap((container) => {
      const original = base.containers.find((candidate) => candidate.id === container.id);
      if (!original) return [];
      const next = pickContainerPresentation(container);
      return presentationEqual(pickContainerPresentation(original), next) ? [] : [next];
    }),
    elements: edited.elements.flatMap((element) => {
      const original = base.elements.find((candidate) => candidate.id === element.id);
      if (!original) return [];
      const next = pickElementPresentation(element);
      return presentationEqual(pickElementPresentation(original), next) ? [] : [next];
    }),
  };
}

export function generateProviderPackCommunityPost(input: {
  pack: ProviderPackV1;
  sloomVersion: string;
  hash?: string;
  testedAt?: string;
  screenshots?: string[];
  safetyNotes?: string;
  dataHandlingNotes?: string;
}): string {
  const pack = stripCredentialMaterial(input.pack);
  const hash = input.hash ?? hashProviderPack(pack);
  const modalities = [...new Set(pack.cards.flatMap((card) => card.modalities))];
  const endpoints = [...new Set(pack.transports.map((transport) =>
    `${transport.approvedOrigin}${transport.endpointPath ?? ' (built-in engine)'}`
  ))];
  const docs = [
    pack.provider.documentationUrl,
    ...(pack.release?.sourceDocumentationUrls ?? []),
    ...pack.cards.flatMap((card) => card.evidence.map((evidence) => evidence.url)),
  ].filter((url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index);
  const lines = [
    `# ${pack.displayName} ${pack.version}`,
    '',
    `Portable Sloom provider pack for ${pack.provider.name}.`,
    '',
    `- Pack ID: \`${pack.packId}\``,
    `- Pack version: \`${pack.version}\``,
    `- Sloom version: \`${input.sloomVersion}\``,
    `- Modalities: ${modalities.join(', ') || 'None declared'}`,
    `- Models: ${pack.cards.length}`,
    `- Test date: ${input.testedAt ?? 'Untested'}`,
    `- SHA-256: \`${hash}\``,
    '',
    '## Models',
    '',
    ...pack.cards.map((card) =>
      `- **${card.displayName}** (\`${card.modelId}\`) — ${card.operations.map((operation) => operation.label).join(', ')}`
    ),
    '',
    '## Disclosed endpoints',
    '',
    ...(endpoints.length ? endpoints.map((endpoint) => `- \`${endpoint}\``) : ['- No network endpoint declared']),
    '',
    '## Source documentation',
    '',
    ...(docs.length ? docs.map((url) => `- ${url}`) : ['- No source documentation supplied']),
    '',
    '## Safety and data handling',
    '',
    input.safetyNotes ?? 'Review provider safety behavior and model-specific restrictions before use.',
    '',
    input.dataHandlingNotes ?? 'Credentials are not included. Review the provider privacy policy before sending media.',
    '',
    '## Screenshots',
    '',
    ...(input.screenshots?.length ? input.screenshots.map((url) => `![Model card](${url})`) : ['Add screenshots before publishing.']),
    '',
    '> This post and its attached `.sloom-provider.json` file must not contain credentials.',
  ];
  return `${lines.join('\n')}\n`;
}

function diffOrigins(
  before: ProviderPackV1,
  after: ProviderPackV1,
  output: ProviderPackDifference[],
): void {
  const left = before.approvedOrigins.map((entry) => entry.origin).sort();
  const right = after.approvedOrigins.map((entry) => entry.origin).sort();
  if (!presentationEqual(left, right)) {
    output.push({
      category: 'trust',
      severity: 'breaking',
      path: 'approvedOrigins',
      before: left,
      after: right,
      message: 'Approved credential destinations changed and require explicit approval.',
    });
  }
}

function diffCredentials(
  before: ProviderPackV1,
  after: ProviderPackV1,
  output: ProviderPackDifference[],
): void {
  const left = new Map(before.credentialSlots.map((slot) => [slot.id, slot]));
  const right = new Map(after.credentialSlots.map((slot) => [slot.id, slot]));
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id);
    const b = right.get(id);
    if (!presentationEqual(a, b)) {
      output.push({
        category: 'credential',
        severity: !a || !b || a.approvedOrigin !== b.approvedOrigin ? 'breaking' : 'warning',
        path: `credentialSlots.${id}`,
        before: a,
        after: b,
        message: !a ? `Credential slot ${id} was added.` : !b ? `Credential slot ${id} was removed.` : `Credential slot ${id} changed.`,
      });
    }
  }
}

function diffTransports(
  before: ProviderPackV1,
  after: ProviderPackV1,
  output: ProviderPackDifference[],
): void {
  const left = new Map(before.transports.map((transport) => [transport.id, transport]));
  const right = new Map(after.transports.map((transport) => [transport.id, transport]));
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id);
    const b = right.get(id);
    if (presentationEqual(a, b)) continue;
    if (a?.endpointPath !== b?.endpointPath || a?.approvedOrigin !== b?.approvedOrigin) {
      output.push({
        category: 'endpoint',
        severity: 'breaking',
        path: `transports.${id}.endpoint`,
        before: a ? `${a.approvedOrigin}${a.endpointPath ?? ''}` : undefined,
        after: b ? `${b.approvedOrigin}${b.endpointPath ?? ''}` : undefined,
        message: `Endpoint routing for ${id} changed.`,
      });
    }
    output.push({
      category: 'transport',
      severity: !a || !b || a.kind !== b.kind ? 'breaking' : 'warning',
      path: `transports.${id}`,
      before: a,
      after: b,
      message: !a ? `Transport ${id} was added.` : !b ? `Transport ${id} was removed.` : `Transport ${id} changed.`,
    });
  }
}

function diffCards(
  before: ProviderPackV1,
  after: ProviderPackV1,
  output: ProviderPackDifference[],
): void {
  const left = new Map(before.cards.map((card) => [card.id, card]));
  const right = new Map(after.cards.map((card) => [card.id, card]));
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id);
    const b = right.get(id);
    if (!a || !b) {
      output.push({
        category: 'model',
        severity: 'breaking',
        path: `cards.${id}`,
        before: a?.modelId,
        after: b?.modelId,
        message: !a ? `Model card ${id} was added.` : `Model card ${id} was removed.`,
      });
      continue;
    }
    const executionA = { fields: a.fields, outputs: a.outputs, operations: a.operations, modalities: a.modalities };
    const executionB = { fields: b.fields, outputs: b.outputs, operations: b.operations, modalities: b.modalities };
    if (!presentationEqual(executionA, executionB)) {
      output.push({
        category: 'capability',
        severity: 'breaking',
        path: `cards.${id}.execution`,
        before: executionA,
        after: executionB,
        message: `Execution bindings or capabilities changed for ${a.displayName}.`,
      });
    }
    if (!presentationEqual(a.layout, b.layout)) {
      output.push({
        category: 'layout',
        severity: 'info',
        path: `cards.${id}.layout`,
        before: a.layout,
        after: b.layout,
        message: `Default card layout changed for ${a.displayName}.`,
      });
    }
  }
}

function applyContainerOverride(
  base: CardLayoutContainerV1,
  override: NonNullable<ModelCardLayoutOverrideV1['containers']>[number] | undefined,
): CardLayoutContainerV1 {
  if (!override) return structuredCloneSafe(base);
  return {
    ...base,
    order: override.order,
    ...(override.columns === undefined ? {} : { columns: override.columns }),
    ...(override.operationColumns === undefined ? {} : { operationColumns: override.operationColumns }),
    ...(override.collapsedByDefault === undefined ? {} : { collapsedByDefault: override.collapsedByDefault }),
    ...(override.x === undefined ? {} : { x: override.x }),
    ...(override.y === undefined ? {} : { y: override.y }),
    ...(override.width === undefined ? {} : { width: override.width }),
    ...(override.height === undefined ? {} : { height: override.height }),
  };
}

function applyElementOverride(
  base: CardLayoutElementV1,
  override: NonNullable<ModelCardLayoutOverrideV1['elements']>[number] | undefined,
  validContainerIds: ReadonlySet<string>,
): CardLayoutElementV1 {
  if (!override) return structuredCloneSafe(base);
  return {
    ...base,
    containerId: validContainerIds.has(override.containerId) ? override.containerId : base.containerId,
    order: override.order,
    ...(override.x === undefined ? {} : { x: override.x }),
    ...(override.y === undefined ? {} : { y: override.y }),
    ...(override.width === undefined ? {} : { width: override.width }),
    ...(override.height === undefined ? {} : { height: override.height }),
    ...(override.columnSpan === undefined ? {} : { columnSpan: override.columnSpan }),
    ...(override.hidden === undefined ? {} : { hidden: override.hidden }),
  };
}

function pickContainerPresentation(container: CardLayoutContainerV1) {
  return {
    id: container.id,
    order: container.order,
    columns: container.columns,
    operationColumns: container.operationColumns,
    collapsedByDefault: container.collapsedByDefault,
    x: container.x,
    y: container.y,
    width: container.width,
    height: container.height,
  };
}

function pickElementPresentation(element: CardLayoutElementV1) {
  return {
    id: element.id,
    containerId: element.containerId,
    order: element.order,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    columnSpan: element.columnSpan,
    hidden: element.hidden,
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
  );
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function presentationEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fileSafe(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'provider-pack';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
