import type { ResultType } from '../types/flow';

export const PROVIDER_PACK_SCHEMA_VERSION = 1 as const;
export const PROVIDER_PACK_EXTENSION = '.sloom-provider.json' as const;

export const PROVIDER_PACK_LIMITS = {
  importBytes: 10 * 1024 * 1024,
  cards: 2_000,
  fieldsPerCard: 512,
  operationsPerCard: 32,
  outputsPerCard: 128,
  containersPerLayout: 256,
  elementsPerLayout: 1_024,
  handlesPerLayout: 4_096,
  optionCatalogEntries: 10_000,
  discoveryRecipes: 64,
  approvedOrigins: 64,
  credentialSlots: 32,
  transportProfiles: 128,
  stringLength: 16_384,
} as const;

export const CARD_WIDTH_PRESETS = {
  compact: 260,
  standard: 390,
  wide: 520,
  extraWide: 650,
} as const;

export const CARD_WIDTH_MIN = 260;
export const CARD_WIDTH_MAX = 1_040;
export const BUNDLED_CARD_HEIGHT_BUDGET = 900;

export type ProviderPackProvenance = 'bundled' | 'local' | 'community' | 'project-embedded';
export type ProviderPackActivationState = 'draft' | 'ready-untested' | 'tested';
export type ModelCardConfidence =
  | 'provider-verified'
  | 'sloom-recognized'
  | 'inferred'
  | 'manual'
  | 'untested';
export type ModelModalityV1 = 'text' | 'image' | 'video' | 'audio';
export type FieldValueTypeV1 =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'image'
  | 'video'
  | 'audio'
  | 'json'
  | 'binary';
export type FieldCardinalityV1 = 'one' | 'many';
export type ModelFieldSemanticRoleV1 =
  | 'prompt'
  | 'system-instruction'
  | 'context'
  | 'media-context'
  | 'source-image'
  | 'mask'
  | 'reference-image'
  | 'control-image'
  | 'source-video'
  | 'start-frame'
  | 'end-frame'
  | 'reference-video'
  | 'script'
  | 'source-audio'
  | 'voice'
  | 'style'
  | 'duration'
  | 'frame-rate'
  | 'width'
  | 'height'
  | 'resolution'
  | 'format'
  | 'seed'
  | 'quantity'
  | 'advanced'
  | 'metadata';
export type ModelOutputSemanticRoleV1 =
  | 'text-output'
  | 'json-output'
  | 'image-output'
  | 'video-output'
  | 'audio-output'
  | 'metadata-output';
export type FieldEncodingV1 =
  | 'json'
  | 'url'
  | 'data-uri'
  | 'base64'
  | 'binary'
  | 'multipart'
  | 'raw';
export type CardControlKindV1 =
  | 'prompt'
  | 'textarea'
  | 'text'
  | 'number'
  | 'slider'
  | 'toggle'
  | 'dropdown'
  | 'media'
  | 'reference-gallery'
  | 'advanced-value';
export type CardContainerKindV1 =
  | 'freeform'
  | 'grid'
  | 'reference-gallery'
  | 'collapsible'
  | 'tabs'
  | 'inline-row'
  | 'pinned-media';
export type CardFitTargetV1 = '1080p' | '1440p' | '4k';
export type CardHandleAnchorV1 = 'card' | 'element';
export type CardHandleSideV1 = 'left' | 'right' | 'top' | 'bottom';
export type CardColumnCountV1 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type TransportKindV1 = 'built-in' | 'http' | 'sse' | 'submit-poll';
export type RequestBodyKindV1 = 'json' | 'multipart' | 'raw' | 'none';
export type OutputExtractionKindV1 = 'json-pointer' | 'binary' | 'sse-text';
export type CredentialAuthTypeV1 =
  | 'none'
  | 'bearer'
  | 'api-key-header'
  | 'basic'
  | 'oauth'
  | 'vertex-adc'
  | 'signed-cloud'
  | 'custom-built-in';

export interface ProviderIdentityV1 {
  name: string;
  homepageUrl?: string;
  documentationUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
  supportUrl?: string;
}

export interface ApprovedOriginV1 {
  origin: string;
  label?: string;
  allowPlainHttpPrivateNetwork?: boolean;
}

export interface CredentialSlotV1 {
  id: string;
  label: string;
  authType: CredentialAuthTypeV1;
  approvedOrigin: string;
  headerName?: string;
  queryParameterName?: never;
  builtInEngineId?: string;
  required?: boolean;
  help?: string;
}

export interface DiscoveryRecipeV1 {
  id: string;
  kind:
    | 'sloom-manifest'
    | 'advertised-schema'
    | 'openapi'
    | 'json-schema'
    | 'known-profile'
    | 'model-list'
    | 'sample-request'
    | 'manual';
  path?: string;
  method?: 'GET' | 'POST';
  credentialSlotId?: string;
  modelListPointer?: string;
  schemaUrlPointer?: string;
}

export interface OptionCatalogEntryV1 {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface OptionCatalogV1 {
  id: string;
  label: string;
  entries?: OptionCatalogEntryV1[];
  remote?: {
    transportProfileId: string;
    endpointPath: string;
    itemsPointer: string;
    valuePointer: string;
    labelPointer: string;
  };
}

export interface RequestBindingV1 {
  fieldId: string;
  requestPath: string;
  omitWhenEmpty?: boolean;
  encoding?: FieldEncodingV1;
}

export interface OutputExtractionV1 {
  outputId: string;
  kind: OutputExtractionKindV1;
  pointer?: string;
  mimeTypePointer?: string;
  defaultMimeType?: string;
  list?: boolean;
}

export interface PollProfileV1 {
  statusPath: string;
  idPointer: string;
  resultPath: string;
  statePointer: string;
  pendingValues: string[];
  successValues: string[];
  failureValues: string[];
  errorPointer?: string;
  cancelPath?: string;
  intervalMs: number;
  timeoutMs: number;
}

export interface TransportProfileV1 {
  id: string;
  label: string;
  kind: TransportKindV1;
  approvedOrigin: string;
  credentialSlotId?: string;
  builtInEngineId?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  endpointPath?: string;
  bodyKind?: RequestBodyKindV1;
  staticHeaders?: Record<string, string>;
  requestBindings?: RequestBindingV1[];
  outputExtractions?: OutputExtractionV1[];
  poll?: PollProfileV1;
  timeoutMs?: number;
}

export interface NumericConstraintV1 {
  min?: number;
  max?: number;
  step?: number;
}

export interface ArrayConstraintV1 {
  minItems?: number;
  maxItems?: number;
  visiblePortCount?: number;
}

export interface ModelFieldV1 {
  id: string;
  label: string;
  description?: string;
  apiPath: string;
  semanticRole: ModelFieldSemanticRoleV1;
  valueType: FieldValueTypeV1;
  cardinality: FieldCardinalityV1;
  required?: boolean;
  connectable?: boolean;
  constraints?: NumericConstraintV1 & ArrayConstraintV1 & {
    minLength?: number;
    maxLength?: number;
  };
  encoding?: FieldEncodingV1;
  optionCatalogId?: string;
  options?: OptionCatalogEntryV1[];
  defaultValue?: unknown;
  operationIds: string[];
  control?: CardControlKindV1;
  advanced?: boolean;
}

export interface ModelOutputV1 {
  id: string;
  label: string;
  semanticRole: ModelOutputSemanticRoleV1;
  resultType: Extract<ResultType, 'text' | 'json' | 'image' | 'video' | 'audio' | 'package' | 'list'>;
  primary?: boolean;
  cardinality: FieldCardinalityV1;
  operationIds: string[];
}

export interface ModelCardOperationV1 {
  id: string;
  label: string;
  transportProfileId: string;
  requiredFieldIds: string[];
  visibleFieldIds: string[];
  inputPortFieldIds: string[];
  outputIds: string[];
  endpointPath?: string;
  requestBindings?: RequestBindingV1[];
  outputExtractions?: OutputExtractionV1[];
  evidence?: ModelCardEvidenceV1[];
}

export interface ModelCardEvidenceV1 {
  title: string;
  url: string;
  verifiedAt?: string;
}

export interface OperationConditionV1 {
  operationIds?: string[];
  fieldId?: string;
  equals?: string | number | boolean;
}

export interface CardLayoutContainerV1 {
  id: string;
  kind: CardContainerKindV1;
  label?: string;
  parentId?: string;
  order: number;
  columns?: CardColumnCountV1;
  operationColumns?: Record<string, CardColumnCountV1>;
  collapsedByDefault?: boolean;
  tabId?: string;
  conditions?: OperationConditionV1[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface CardLayoutElementV1 {
  id: string;
  fieldId?: string;
  outputId?: string;
  containerId: string;
  order: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  columnSpan?: CardColumnCountV1;
  hidden?: boolean;
  conditions?: OperationConditionV1[];
}

/**
 * Presentation-only placement for a stable Flow port.
 *
 * The portId points at an immutable field/output binding. Moving a handle never
 * changes routing, request paths, credentials, or execution behavior.
 */
export interface CardHandlePlacementV1 {
  portId: string;
  anchor: CardHandleAnchorV1;
  elementId?: string;
  side: CardHandleSideV1;
  offsetPercent: number;
}

export interface CardLayoutV1 {
  schemaVersion: 1;
  id: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  fitTarget: CardFitTargetV1;
  heightBudget: number;
  containers: CardLayoutContainerV1[];
  elements: CardLayoutElementV1[];
  handlePlacements?: CardHandlePlacementV1[];
  approvedHeightException?: {
    reason: string;
    approvedBy: string;
  };
}

export interface ModelCardLayoutOverrideV1 {
  schemaVersion: 1;
  cardId: string;
  operationId?: string;
  width?: number;
  fitTarget?: CardFitTargetV1;
  containers?: Array<Pick<CardLayoutContainerV1,
    'id' | 'order' | 'columns' | 'operationColumns' | 'collapsedByDefault' | 'x' | 'y' | 'width' | 'height'
  >>;
  elements?: Array<Pick<CardLayoutElementV1,
    'id' | 'containerId' | 'order' | 'x' | 'y' | 'width' | 'height' | 'columnSpan' | 'hidden'
  >>;
  handlePlacements?: CardHandlePlacementV1[];
}

export interface FlowModelCardV1 {
  schemaVersion: 1;
  id: string;
  modelId: string;
  displayName: string;
  description?: string;
  modalities: ModelModalityV1[];
  fields: ModelFieldV1[];
  outputs: ModelOutputV1[];
  operations: ModelCardOperationV1[];
  evidence: ModelCardEvidenceV1[];
  confidence: ModelCardConfidence;
  status: ProviderPackActivationState;
  layout: CardLayoutV1;
  tags?: string[];
}

export interface ProviderPackReleaseMetadataV1 {
  minimumSloomVersion?: string;
  sourceDocumentationUrls?: string[];
  forumCategoryUrl?: string;
  githubDiscussionsCategoryUrl?: string;
}

export interface ProviderPackV1 {
  schemaVersion: 1;
  packId: string;
  version: string;
  displayName: string;
  description?: string;
  provider: ProviderIdentityV1;
  approvedOrigins: ApprovedOriginV1[];
  credentialSlots: CredentialSlotV1[];
  discovery: DiscoveryRecipeV1[];
  optionCatalogs: OptionCatalogV1[];
  transports: TransportProfileV1[];
  cards: FlowModelCardV1[];
  release?: ProviderPackReleaseMetadataV1;
}

export interface ProviderPackRefV1 {
  packId: string;
  version: string;
  hash: string;
}

export interface ModelCardRefV1 extends ProviderPackRefV1 {
  cardId: string;
}

export interface ProviderPackRuntimeRecord {
  pack: ProviderPackV1;
  hash: string;
  provenance: ProviderPackProvenance;
  importedAt: number;
  active: boolean;
  /** Set only after explicit activation; remains true when a newer version becomes active. */
  executionApproved?: boolean;
  sourceLabel?: string;
  trustApprovedOrigins: string[];
  testStatusByOperation: Record<string, 'untested' | 'passed' | 'failed'>;
}

export interface LocalCredentialRecordV1 {
  schemaVersion: 1;
  packId: string;
  slotId: string;
  approvedOrigin: string;
  encryptedValue: string;
  updatedAt: number;
}

export interface ProviderPackDraftV1 {
  schemaVersion: 1;
  id: string;
  pack: ProviderPackV1;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface PersonalModelCardLayoutV1 {
  schemaVersion: 1;
  packId: string;
  cardId: string;
  packHash: string;
  override: ModelCardLayoutOverrideV1;
  updatedAt: number;
}

/** Stored only inside the passphrase-encrypted settings backup envelope. */
export interface ProviderPackSettingsBackupV1 {
  schemaVersion: 1;
  packs: Array<{
    pack: ProviderPackV1;
    sourceLabel?: string;
  }>;
  drafts: ProviderPackDraftV1[];
  personalLayouts: PersonalModelCardLayoutV1[];
  credentials: Array<{
    packId: string;
    slotId: string;
    approvedOrigin: string;
    value: string;
  }>;
}

export interface EmbeddedProviderPackSnapshotV1 {
  schemaVersion: 1;
  pack: ProviderPackV1;
  /** Hash of the original installed full pack referenced by Flow nodes. */
  hash: string;
  /** Hash of this credential-free, card-trimmed snapshot payload. */
  contentHash: string;
  referencedCardIds: string[];
}

export interface ProviderPackDifference {
  category: 'endpoint' | 'model' | 'capability' | 'transport' | 'layout' | 'credential' | 'trust';
  severity: 'info' | 'warning' | 'breaking';
  path: string;
  before?: unknown;
  after?: unknown;
  message: string;
}

export interface ModelCardValidationIssue {
  code: string;
  severity: 'blocking' | 'warning';
  message: string;
  cardId?: string;
  operationId?: string;
  fieldId?: string;
  outputId?: string;
  containerId?: string;
  elementId?: string;
  repair?: {
    id:
      | 'move-inside'
      | 'increase-width'
      | 'four-columns'
      | 'move-to-advanced'
      | 'add-output'
      | 'bind-source-image'
      | 'auto-arrange';
    label: string;
  };
}

export interface ProviderPackValidationResult {
  validStructure: boolean;
  activatable: boolean;
  issues: ModelCardValidationIssue[];
}

export interface ProviderPackReleasePolicyV1 {
  lockedPackIds?: string[];
  lockedCardIds?: string[];
  lockedOperationIds?: string[];
  lockedFieldIds?: string[];
  lockedValues?: Record<string, unknown[]>;
  allowedApprovedOrigins?: string[];
}

export interface ResolvedCardLayoutV1 {
  layout: CardLayoutV1;
  source: 'node' | 'personal' | 'pack' | 'automatic';
}
