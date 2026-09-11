import {
  BUNDLED_CARD_HEIGHT_BUDGET,
  CARD_WIDTH_MAX,
  CARD_WIDTH_MIN,
  PROVIDER_PACK_LIMITS,
  PROVIDER_PACK_SCHEMA_VERSION,
  type CardLayoutElementV1,
  type FlowModelCardV1,
  type ModelCardValidationIssue,
  type ProviderPackReleasePolicyV1,
  type ProviderPackV1,
  type ProviderPackValidationResult,
  type TransportProfileV1,
} from './providerPackContracts';

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,255}$/i;
const VERSION = /^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][a-z0-9.-]+)?$/i;
const FORBIDDEN_IMPORT_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'javascript',
  'script',
  'expression',
  'executable',
  'plugin',
  'html',
  'template',
  'code',
]);
const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'host',
  'origin',
  'referer',
  'proxy-authorization',
  'sec-websocket-protocol',
]);
const VALID_MODALITIES = new Set(['text', 'image', 'video', 'audio']);
const VALID_FIELD_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'enum', 'image', 'video', 'audio', 'json', 'binary']);
const VALID_CARDINALITIES = new Set(['one', 'many']);
const VALID_ENCODINGS = new Set(['json', 'url', 'data-uri', 'base64', 'binary', 'multipart', 'raw']);
const VALID_CONTROLS = new Set(['prompt', 'textarea', 'text', 'number', 'slider', 'toggle', 'dropdown', 'media', 'reference-gallery', 'advanced-value']);
const VALID_CONTAINER_KINDS = new Set(['freeform', 'grid', 'reference-gallery', 'collapsible', 'tabs', 'inline-row', 'pinned-media']);
const VALID_HANDLE_ANCHORS = new Set(['card', 'element']);
const VALID_HANDLE_SIDES = new Set(['left', 'right', 'top', 'bottom']);
const VALID_CONFIDENCE = new Set(['provider-verified', 'sloom-recognized', 'inferred', 'manual', 'untested']);
const VALID_CARD_STATUS = new Set(['draft', 'ready-untested', 'tested']);
const VALID_TRANSPORT_KINDS = new Set(['built-in', 'http', 'sse', 'submit-poll']);
const VALID_BODY_KINDS = new Set(['json', 'multipart', 'raw', 'none']);
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH']);
const VALID_AUTH_TYPES = new Set(['none', 'bearer', 'api-key-header', 'basic', 'oauth', 'vertex-adc', 'signed-cloud', 'custom-built-in']);
const VALID_OUTPUT_TYPES = new Set(['text', 'json', 'image', 'video', 'audio', 'package', 'list']);
const VALID_OUTPUT_ROLES = new Set(['text-output', 'json-output', 'image-output', 'video-output', 'audio-output', 'metadata-output']);
const VALID_FIELD_ROLES = new Set([
  'prompt', 'system-instruction', 'context', 'media-context', 'source-image', 'mask',
  'reference-image', 'control-image', 'source-video', 'start-frame', 'end-frame',
  'reference-video', 'script', 'source-audio', 'voice', 'style', 'duration',
  'frame-rate', 'width', 'height', 'resolution', 'format', 'seed', 'quantity',
  'advanced', 'metadata',
]);

export class ProviderPackImportError extends Error {
  readonly issues: ModelCardValidationIssue[];

  constructor(message: string, issues: ModelCardValidationIssue[] = []) {
    super(message);
    this.name = 'ProviderPackImportError';
    this.issues = issues;
  }
}

export function parseProviderPackText(text: string): ProviderPackV1 {
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > PROVIDER_PACK_LIMITS.importBytes) {
    throw new ProviderPackImportError('Provider pack exceeds the 10 MiB import limit.');
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ProviderPackImportError('Provider pack is not valid JSON.');
  }

  inspectHostileJson(value);
  const validation = validateProviderPack(value);
  if (!validation.validStructure) {
    throw new ProviderPackImportError(
      validation.issues.find((issue) => issue.severity === 'blocking')?.message
        ?? 'Provider pack has an invalid structure.',
      validation.issues,
    );
  }
  return value as ProviderPackV1;
}

export function validateProviderPack(
  value: unknown,
  options: {
    provenance?: 'bundled' | 'local' | 'community' | 'project-embedded';
    releasePolicy?: ProviderPackReleasePolicyV1;
  } = {},
): ProviderPackValidationResult {
  const issues: ModelCardValidationIssue[] = [];
  if (!isRecord(value)) {
    return invalid('pack-object', 'Provider pack must be a JSON object.');
  }
  if (value.schemaVersion !== PROVIDER_PACK_SCHEMA_VERSION) {
    issues.push(blocking('schema-version', 'Provider pack schemaVersion must be 1.'));
  }
  requireIdentifier(value.packId, 'pack-id', 'Pack ID', issues);
  if (typeof value.version !== 'string' || !VERSION.test(value.version)) {
    issues.push(blocking('pack-version', 'Pack version must be a bounded numeric version such as 1.0.0.'));
  }
  requireString(value.displayName, 'display-name', 'Pack display name', issues);
  if (!isRecord(value.provider)) {
    issues.push(blocking('provider-identity', 'Provider identity is missing.'));
  } else {
    requireString(value.provider.name, 'provider-name', 'Provider name', issues);
    for (const key of ['homepageUrl', 'documentationUrl', 'privacyUrl', 'termsUrl', 'supportUrl']) {
      validateOptionalHttpUrl(value.provider[key], `provider-${key}`, `Provider ${key}`, issues);
    }
  }

  const approvedOrigins = boundedArray(
    value.approvedOrigins,
    PROVIDER_PACK_LIMITS.approvedOrigins,
    'approved-origins',
    'Approved origins',
    issues,
  );
  const normalizedOrigins = new Set<string>();
  for (const [index, entry] of approvedOrigins.entries()) {
    if (!isRecord(entry) || typeof entry.origin !== 'string') {
      issues.push(blocking('approved-origin', `Approved origin ${index + 1} is invalid.`));
      continue;
    }
    const origin = validateApprovedOrigin(entry.origin, entry.allowPlainHttpPrivateNetwork === true);
    if (!origin) {
      issues.push(blocking(
        'approved-origin',
        `${entry.origin || `Approved origin ${index + 1}`} must be an exact HTTPS origin. Plain HTTP is allowed only for an explicitly approved loopback or private-LAN origin.`,
      ));
      continue;
    }
    if (normalizedOrigins.has(origin)) {
      issues.push(blocking('duplicate-origin', `Approved origin ${origin} is duplicated.`));
    }
    normalizedOrigins.add(origin);
  }

  const credentialSlots = boundedArray(
    value.credentialSlots,
    PROVIDER_PACK_LIMITS.credentialSlots,
    'credential-slots',
    'Credential slots',
    issues,
  );
  const credentialSlotIds = new Set<string>();
  for (const slot of credentialSlots) {
    if (!isRecord(slot)) {
      issues.push(blocking('credential-slot', 'A credential slot is not an object.'));
      continue;
    }
    requireIdentifier(slot.id, 'credential-slot-id', 'Credential slot ID', issues);
    requireString(slot.label, 'credential-slot-label', 'Credential slot label', issues);
    if (typeof slot.id === 'string') {
      duplicate(slot.id, credentialSlotIds, 'credential-slot-duplicate', 'Credential slot', issues);
    }
    if (!VALID_AUTH_TYPES.has(String(slot.authType))) {
      issues.push(blocking('credential-auth', `Credential slot ${String(slot.id)} has an unsupported authentication type.`));
    }
    const exactSlotOrigin = typeof slot.approvedOrigin === 'string'
      ? validateApprovedOrigin(slot.approvedOrigin, true)
      : null;
    if (!exactSlotOrigin || !normalizedOrigins.has(exactSlotOrigin)) {
      issues.push(blocking('credential-origin', `Credential slot ${String(slot.id)} must use one exact approved origin.`));
    }
    if (
      slot.authType === 'api-key-header'
      && (
        typeof slot.headerName !== 'string'
        || !/^[a-z0-9-]{1,128}$/i.test(slot.headerName)
        || FORBIDDEN_HEADERS.has(slot.headerName.toLowerCase())
      )
    ) {
      issues.push(blocking('credential-header', `Credential slot ${String(slot.id)} needs a safe API-key header name.`));
    }
    if (
      ['oauth', 'vertex-adc', 'signed-cloud', 'custom-built-in'].includes(String(slot.authType))
      && !IDENTIFIER.test(String(slot.builtInEngineId ?? ''))
    ) {
      issues.push(blocking('credential-engine', `Credential slot ${String(slot.id)} requires a registered built-in engine.`));
    }
    if ('value' in slot || 'key' in slot || 'token' in slot || 'secret' in slot || 'queryParameterName' in slot) {
      issues.push(blocking('credential-material', `Credential slot ${String(slot.id)} contains credential material or a credential-bearing URL rule.`));
    }
  }

  const discovery = boundedArray(
    value.discovery,
    PROVIDER_PACK_LIMITS.discoveryRecipes,
    'discovery-recipes',
    'Discovery recipes',
    issues,
  );
  for (const recipe of discovery) {
    if (!isRecord(recipe)) {
      issues.push(blocking('discovery-recipe', 'A discovery recipe is invalid.'));
      continue;
    }
    requireIdentifier(recipe.id, 'discovery-id', 'Discovery recipe ID', issues);
    if (recipe.path !== undefined) validateRelativePath(recipe.path, 'discovery-path', issues);
    if (typeof recipe.credentialSlotId === 'string' && !credentialSlotIds.has(recipe.credentialSlotId)) {
      issues.push(blocking('discovery-credential', `Discovery recipe ${String(recipe.id)} references a missing credential slot.`));
    }
  }

  const optionCatalogs = boundedArray(value.optionCatalogs, 512, 'option-catalogs', 'Option catalogs', issues);
  let optionEntryCount = 0;
  const optionCatalogIds = new Set<string>();
  for (const catalog of optionCatalogs) {
    if (!isRecord(catalog)) {
      issues.push(blocking('option-catalog', 'An option catalog is invalid.'));
      continue;
    }
    requireIdentifier(catalog.id, 'option-catalog-id', 'Option catalog ID', issues);
    if (typeof catalog.id === 'string') duplicate(catalog.id, optionCatalogIds, 'option-catalog-duplicate', 'Option catalog', issues);
    if (Array.isArray(catalog.entries)) optionEntryCount += catalog.entries.length;
  }
  if (optionEntryCount > PROVIDER_PACK_LIMITS.optionCatalogEntries) {
    issues.push(blocking('option-entry-limit', 'Provider pack exceeds the 10,000 option-entry limit.'));
  }

  const transports = boundedArray(
    value.transports,
    PROVIDER_PACK_LIMITS.transportProfiles,
    'transport-profiles',
    'Transport profiles',
    issues,
  );
  const transportIds = new Set<string>();
  for (const transport of transports) {
    validateTransport(transport, normalizedOrigins, credentialSlotIds, transportIds, issues);
  }

  const cards = boundedArray(value.cards, PROVIDER_PACK_LIMITS.cards, 'cards', 'Model cards', issues);
  const cardIds = new Set<string>();
  for (const card of cards) {
    if (!isRecord(card)) {
      issues.push(blocking('card-object', 'A model card is not an object.'));
      continue;
    }
    if (typeof card.id === 'string') duplicate(card.id, cardIds, 'card-duplicate', 'Model card', issues);
    const typedCard = card as unknown as FlowModelCardV1;
    issues.push(...validateModelCard(typedCard, transportIds, optionCatalogIds, options.provenance));
    issues.push(...validatePrimaryOutputExtraction(typedCard, transports));
  }

  issues.push(...validateReleasePolicy(value as unknown as ProviderPackV1, options.releasePolicy));
  const validStructure = !issues.some((issue) =>
    issue.severity === 'blocking' && (
      issue.code.startsWith('pack-')
      || issue.code.startsWith('schema-')
      || issue.code.startsWith('provider-')
      || issue.code.startsWith('approved-')
      || issue.code.startsWith('credential-')
      || issue.code.startsWith('discovery-')
      || issue.code.startsWith('transport-')
      || issue.code.endsWith('-limit')
      || issue.code === 'hostile-import'
    )
  );
  return {
    validStructure,
    activatable: validStructure && !issues.some((issue) => issue.severity === 'blocking'),
    issues,
  };
}

export function validateModelCard(
  card: FlowModelCardV1,
  transportIds = new Set<string>(),
  optionCatalogIds = new Set<string>(),
  provenance: 'bundled' | 'local' | 'community' | 'project-embedded' = 'local',
): ModelCardValidationIssue[] {
  const issues: ModelCardValidationIssue[] = [];
  if (!isRecord(card)) return [blocking('card-object', 'Model card must be an object.')];
  requireIdentifier(card.id, 'card-id', 'Card ID', issues, card.id);
  requireString(card.modelId, 'model-id', 'Model ID', issues, card.id);
  requireString(card.displayName, 'card-name', 'Card display name', issues, card.id);
  if (card.schemaVersion !== 1) issues.push(blocking('card-schema', 'Model card schemaVersion must be 1.', card.id));
  if (!Array.isArray(card.modalities) || card.modalities.length === 0) {
    issues.push(blocking('card-modality', 'Choose at least one text, image, video, or audio modality.', card.id));
  } else if (card.modalities.some((modality) => !VALID_MODALITIES.has(String(modality)))) {
    issues.push(blocking('card-modality', 'Card modalities must be text, image, video, or audio.', card.id));
  }
  if (!VALID_CONFIDENCE.has(String(card.confidence))) {
    issues.push(blocking('card-confidence', 'Card confidence has an unsupported value.', card.id));
  }
  if (!VALID_CARD_STATUS.has(String(card.status))) {
    issues.push(blocking('card-status', 'Card status must be Draft, Ready—untested, or Tested.', card.id));
  }

  const fields = boundedArray(
    card.fields,
    PROVIDER_PACK_LIMITS.fieldsPerCard,
    'field-limit',
    `${card.displayName || 'Card'} fields`,
    issues,
    card.id,
  );
  const fieldIds = new Set<string>();
  const apiPaths = new Set<string>();
  for (const field of fields) {
    if (!isRecord(field)) {
      issues.push(blocking('field-object', 'A field is invalid.', card.id));
      continue;
    }
    requireIdentifier(field.id, 'field-id', 'Field ID', issues, card.id);
    requireString(field.label, 'field-label', 'Field label', issues, card.id);
    requireString(field.apiPath, 'field-api-path', 'Field API path', issues, card.id);
    if (/(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|password|client[_ -]?secret)/i.test(
      `${String(field.id)} ${String(field.apiPath)} ${String(field.label)}`,
    )) {
      issues.push(blocking(
        'credential-field',
        `${String(field.label)} looks like a credential. Use a named local credential slot instead of a model-card field.`,
        card.id,
        String(field.id),
      ));
    }
    if (typeof field.id === 'string') duplicate(field.id, fieldIds, 'duplicate-binding', 'Field', issues, card.id);
    if (typeof field.apiPath === 'string') duplicate(field.apiPath, apiPaths, 'duplicate-binding', 'API binding', issues, card.id);
    if (field.optionCatalogId && !optionCatalogIds.has(String(field.optionCatalogId))) {
      issues.push(blocking('missing-option-catalog', `${String(field.label)} references a missing option catalog.`, card.id, String(field.id)));
    }
    if (!VALID_FIELD_TYPES.has(String(field.valueType))) {
      issues.push(blocking('field-type', `${String(field.label)} has an unsupported value type.`, card.id, String(field.id)));
    }
    if (!VALID_FIELD_ROLES.has(String(field.semanticRole))) {
      issues.push(blocking('field-semantic-role', `${String(field.label)} has an unsupported semantic role.`, card.id, String(field.id)));
    }
    if (!VALID_CARDINALITIES.has(String(field.cardinality))) {
      issues.push(blocking('field-cardinality', `${String(field.label)} must accept one value or a bounded list.`, card.id, String(field.id)));
    }
    if (field.encoding !== undefined && !VALID_ENCODINGS.has(String(field.encoding))) {
      issues.push(blocking('field-encoding', `${String(field.label)} has an unsupported request encoding.`, card.id, String(field.id)));
    }
    if (field.control !== undefined && !VALID_CONTROLS.has(String(field.control))) {
      issues.push(blocking('field-control', `${String(field.label)} has an unsupported visual control.`, card.id, String(field.id)));
    }
    if (!semanticFieldTypeIsCompatible(String(field.semanticRole), String(field.valueType))) {
      issues.push({
        ...blocking('field-modality-mapping', `${String(field.label)} does not match the type expected for ${String(field.semanticRole)}.`, card.id, String(field.id)),
        ...(['source-image', 'mask', 'reference-image', 'control-image', 'start-frame', 'end-frame'].includes(String(field.semanticRole))
          ? { repair: { id: 'bind-source-image' as const, label: 'Bind this field as image media' } }
          : {}),
      });
    }
    if (
      field.required === true
      && ['image', 'video', 'audio'].includes(String(field.valueType))
      && field.connectable !== true
    ) {
      issues.push({
        ...blocking('required-media-port', `${String(field.label)} is required media and must be exposed as a Flow port.`, card.id, String(field.id)),
        repair: { id: 'bind-source-image', label: 'Expose this media as a Flow port' },
      });
    }
    if (field.valueType === 'boolean' && field.control && field.control !== 'toggle') {
      issues.push(blocking('field-control-mapping', `${String(field.label)} is boolean and should use a toggle.`, card.id, String(field.id)));
    }
    if (field.valueType === 'enum' && field.control && field.control !== 'dropdown') {
      issues.push(blocking('field-control-mapping', `${String(field.label)} is an enum and should use a dropdown.`, card.id, String(field.id)));
    }
    if (isRecord(field.constraints)) {
      const min = numeric(field.constraints.min);
      const max = numeric(field.constraints.max);
      const minItems = numeric(field.constraints.minItems);
      const maxItems = numeric(field.constraints.maxItems);
      if (min !== undefined && max !== undefined && min > max) {
        issues.push(blocking('field-constraint', `${String(field.label)} has a minimum greater than its maximum.`, card.id, String(field.id)));
      }
      if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
        issues.push(blocking('field-constraint', `${String(field.label)} has a minimum item count greater than its maximum.`, card.id, String(field.id)));
      }
    }
    if (
      field.connectable === true
      && field.cardinality === 'many'
      && ['image', 'video', 'audio'].includes(String(field.valueType))
    ) {
      const max = isRecord(field.constraints) ? field.constraints.maxItems : undefined;
      const visible = isRecord(field.constraints) ? field.constraints.visiblePortCount : undefined;
      if (!positiveInteger(max) && !positiveInteger(visible)) {
        issues.push({
          ...blocking(
            'unbounded-media-array',
            `${String(field.label)} needs a finite maximum or visible port count before activation.`,
            card.id,
            String(field.id),
          ),
          repair: { id: 'bind-source-image', label: 'Expose four bounded media ports' },
        });
      }
    }
  }

  const outputs = boundedArray(
    card.outputs,
    PROVIDER_PACK_LIMITS.outputsPerCard,
    'output-limit',
    `${card.displayName || 'Card'} outputs`,
    issues,
    card.id,
  );
  const outputIds = new Set<string>();
  for (const output of outputs) {
    if (!isRecord(output)) {
      issues.push(blocking('output-object', 'An output is invalid.', card.id));
      continue;
    }
    requireIdentifier(output.id, 'output-id', 'Output ID', issues, card.id);
    if (typeof output.id === 'string') duplicate(output.id, outputIds, 'duplicate-output', 'Output', issues, card.id);
    if (!VALID_OUTPUT_TYPES.has(String(output.resultType)) || !VALID_OUTPUT_ROLES.has(String(output.semanticRole))) {
      issues.push({
        ...blocking('output-type', `${String(output.label ?? output.id)} has an unsupported output type or semantic role.`, card.id),
        outputId: String(output.id),
      });
    } else if (!semanticOutputTypeIsCompatible(String(output.semanticRole), String(output.resultType))) {
      issues.push({
        ...blocking('output-modality-mapping', `${String(output.label ?? output.id)} has a result type that conflicts with its semantic role.`, card.id),
        outputId: String(output.id),
      });
    }
    if (!VALID_CARDINALITIES.has(String(output.cardinality))) {
      issues.push({
        ...blocking('output-cardinality', `${String(output.label ?? output.id)} must return one value or a list.`, card.id),
        outputId: String(output.id),
      });
    }
  }
  if (!outputs.some((output) => isRecord(output) && output.primary === true)) {
    issues.push({
      ...blocking('missing-primary-output', 'Add one primary output before activating this card.', card.id),
      repair: { id: 'add-output', label: 'Add missing output' },
    });
  }

  const operations = boundedArray(
    card.operations,
    PROVIDER_PACK_LIMITS.operationsPerCard,
    'operation-limit',
    `${card.displayName || 'Card'} operations`,
    issues,
    card.id,
  );
  const operationIds = new Set<string>();
  for (const operation of operations) {
    if (!isRecord(operation)) {
      issues.push(blocking('operation-object', 'An operation is invalid.', card.id));
      continue;
    }
    requireIdentifier(operation.id, 'operation-id', 'Operation ID', issues, card.id);
    if (typeof operation.id === 'string') duplicate(operation.id, operationIds, 'duplicate-operation', 'Operation', issues, card.id);
    if (!transportIds.has(String(operation.transportProfileId))) {
      issues.push(blocking('undefined-operation-routing', `${String(operation.label || operation.id)} has no valid transport route.`, card.id, undefined, String(operation.id)));
    }
    const requiredIds = stringArray(operation.requiredFieldIds);
    const visibleIds = stringArray(operation.visibleFieldIds);
    const portIds = stringArray(operation.inputPortFieldIds);
    for (const requiredId of requiredIds) {
      if (!fieldIds.has(requiredId)) {
        issues.push(blocking('missing-required-field', `${String(operation.label || operation.id)} requires missing field ${requiredId}.`, card.id, requiredId, String(operation.id)));
      }
      if (!visibleIds.includes(requiredId)) {
        issues.push(blocking('required-hidden', `${String(operation.label || operation.id)} hides required field ${requiredId}.`, card.id, requiredId, String(operation.id)));
      }
    }
    for (const visibleId of visibleIds) {
      if (!fieldIds.has(visibleId)) {
        issues.push(blocking('visible-field', `${String(operation.label || operation.id)} displays missing field ${visibleId}.`, card.id, visibleId, String(operation.id)));
      }
    }
    for (const portId of portIds) {
      const portField = fields.find((field) => isRecord(field) && field.id === portId);
      if (!isRecord(portField) || portField.connectable !== true) {
        issues.push(blocking('invalid-input-port', `${String(operation.label || operation.id)} exposes ${portId} as a port without a connectable field binding.`, card.id, portId, String(operation.id)));
      }
    }
    for (const outputId of stringArray(operation.outputIds)) {
      if (!outputIds.has(outputId)) {
        issues.push(blocking('missing-operation-output', `${String(operation.label || operation.id)} references missing output ${outputId}.`, card.id, undefined, String(operation.id)));
      }
    }
    const operationBindings = Array.isArray(operation.requestBindings) ? operation.requestBindings : [];
    const boundFields = new Set<string>();
    const boundPaths = new Set<string>();
    for (const binding of operationBindings) {
      if (!isRecord(binding) || typeof binding.fieldId !== 'string' || !fieldIds.has(binding.fieldId)) {
        issues.push(blocking('operation-binding', `${String(operation.label || operation.id)} contains a binding for a missing field.`, card.id, undefined, String(operation.id)));
        continue;
      }
      duplicate(binding.fieldId, boundFields, 'duplicate-binding', 'Operation field binding', issues, card.id);
      if (typeof binding.requestPath !== 'string' || !safeDeclarativePath(binding.requestPath)) {
        issues.push(blocking('operation-binding-path', `${String(operation.label || operation.id)} contains an unsafe request path.`, card.id, binding.fieldId, String(operation.id)));
      } else {
        duplicate(binding.requestPath, boundPaths, 'duplicate-binding', 'Operation request path', issues, card.id);
      }
      if (binding.encoding !== undefined && !VALID_ENCODINGS.has(String(binding.encoding))) {
        issues.push(blocking('operation-binding-encoding', `${String(operation.label || operation.id)} contains an unsupported field encoding.`, card.id, binding.fieldId, String(operation.id)));
      }
    }
    if (operation.endpointPath !== undefined) validateRelativePath(operation.endpointPath, 'operation-path', issues);
  }
  if (operations.length === 0) {
    issues.push(blocking('undefined-operation-routing', 'Add at least one operation and transport route.', card.id));
  }

  for (const field of fields) {
    if (!isRecord(field)) continue;
    for (const operationId of stringArray(field.operationIds)) {
      if (!operationIds.has(operationId)) {
        issues.push(blocking('field-operation', `${String(field.label)} references missing operation ${operationId}.`, card.id, String(field.id)));
      }
    }
  }
  for (const output of outputs) {
    if (!isRecord(output)) continue;
    for (const operationId of stringArray(output.operationIds)) {
      if (!operationIds.has(operationId)) {
        issues.push({
          ...blocking('output-operation', `${String(output.label ?? output.id)} references missing operation ${operationId}.`, card.id, undefined, operationId),
          outputId: String(output.id),
        });
      }
    }
  }

  issues.push(...validateCardLayout(card, fields, outputs));
  const estimatedHeight = estimateLayoutHeight(card);
  if (estimatedHeight > card.layout?.heightBudget) {
    const overBy = Math.round(estimatedHeight - card.layout.heightBudget);
    issues.push({
      code: 'height-budget',
      severity: provenance === 'bundled' && !card.layout?.approvedHeightException ? 'blocking' : 'warning',
      cardId: card.id,
      message: `${card.displayName} is about ${overBy}px over its ${card.layout.heightBudget}px visible-height target. Widen a gallery, use more columns, tabs, or collapse Advanced.`,
      repair: { id: 'auto-arrange', label: 'Auto Arrange this operation' },
    });
  }
  if (provenance === 'bundled' && card.layout?.heightBudget > BUNDLED_CARD_HEIGHT_BUDGET && !card.layout.approvedHeightException) {
    issues.push(blocking('bundled-height-budget', 'Bundled card defaults must target 900px or document an approved exception.', card.id));
  }
  if (card.status === 'draft') {
    issues.push(blocking('draft-card', `${card.displayName} is a saved draft and cannot run until its blocking issues are fixed.`, card.id));
  }
  return issues;
}

function validatePrimaryOutputExtraction(
  card: FlowModelCardV1,
  transports: unknown[],
): ModelCardValidationIssue[] {
  const issues: ModelCardValidationIssue[] = [];
  const transportById = new Map(
    transports.filter(isRecord).map((transport) => [String(transport.id), transport]),
  );
  for (const operation of Array.isArray(card.operations) ? card.operations : []) {
    if (!isRecord(operation)) continue;
    const transport = transportById.get(String(operation.transportProfileId));
    if (!transport || transport.kind === 'built-in') continue;
    const outputIds = stringArray(operation.outputIds);
    const primary = (Array.isArray(card.outputs) ? card.outputs : []).find((output) =>
      isRecord(output) && output.primary === true && outputIds.includes(String(output.id))
    );
    if (!isRecord(primary)) continue;
    const extractionCandidates = Array.isArray(operation.outputExtractions)
      ? operation.outputExtractions
      : Array.isArray(transport.outputExtractions)
        ? transport.outputExtractions
        : [];
    const genericBindings = Array.isArray(operation.requestBindings)
      ? operation.requestBindings
      : Array.isArray(transport.requestBindings)
        ? transport.requestBindings
        : [];
    for (const binding of genericBindings) {
      if (isRecord(binding) && !safeBindingPath(String(binding.requestPath ?? ''))) {
        issues.push(blocking(
          'operation-binding-path',
          `${String(operation.label ?? operation.id)} contains a request path that cannot be executed safely.`,
          card.id,
          typeof binding.fieldId === 'string' ? binding.fieldId : undefined,
          String(operation.id),
        ));
      }
    }
    const extraction = extractionCandidates.find((candidate) =>
      isRecord(candidate) && candidate.outputId === primary.id
    );
    if (!isRecord(extraction)) {
      issues.push({
        ...blocking(
          'missing-primary-extraction',
          `${String(operation.label ?? operation.id)} needs a primary output extraction before activation.`,
          card.id,
          undefined,
          String(operation.id),
        ),
        outputId: String(primary.id),
        repair: { id: 'add-output', label: 'Add missing output' },
      });
      continue;
    }
    if (!['json-pointer', 'binary', 'sse-text'].includes(String(extraction.kind))) {
      issues.push(blocking('output-extraction-kind', `${String(operation.label ?? operation.id)} uses an unsupported output extraction.`, card.id, undefined, String(operation.id)));
    }
    if (
      extraction.kind === 'json-pointer'
      && (typeof extraction.pointer !== 'string' || !safeJsonPointer(extraction.pointer))
    ) {
      issues.push(blocking('output-extraction-pointer', `${String(operation.label ?? operation.id)} needs a safe JSON Pointer for its primary output.`, card.id, undefined, String(operation.id)));
    }
    if (transport.kind === 'sse' && extraction.kind !== 'sse-text') {
      issues.push(blocking('output-extraction-stream', `${String(operation.label ?? operation.id)} needs an SSE text extraction.`, card.id, undefined, String(operation.id)));
    }
  }
  return issues;
}

function semanticFieldTypeIsCompatible(role: string, valueType: string): boolean {
  if (!VALID_FIELD_ROLES.has(role) || !VALID_FIELD_TYPES.has(valueType)) return false;
  if (['source-image', 'mask', 'reference-image', 'control-image', 'start-frame', 'end-frame'].includes(role)) {
    return valueType === 'image';
  }
  if (['source-video', 'reference-video'].includes(role)) return valueType === 'video';
  if (role === 'source-audio') return valueType === 'audio';
  if (['duration', 'frame-rate', 'width', 'height', 'seed', 'quantity'].includes(role)) {
    if (role === 'duration' && ['enum', 'string'].includes(valueType)) return true;
    return valueType === 'number' || valueType === 'integer';
  }
  return true;
}

function semanticOutputTypeIsCompatible(role: string, resultType: string): boolean {
  if (role === 'text-output') return resultType === 'text' || resultType === 'list';
  if (role === 'json-output') return resultType === 'json' || resultType === 'list';
  if (role === 'image-output') return resultType === 'image' || resultType === 'list';
  if (role === 'video-output') return resultType === 'video' || resultType === 'list';
  if (role === 'audio-output') return resultType === 'audio' || resultType === 'list';
  if (role === 'metadata-output') return ['json', 'package', 'list'].includes(resultType);
  return false;
}

function safeBindingPath(path: string): boolean {
  if (!path.trim() || path.length > 1_024) return false;
  const parts = path.startsWith('/') ? path.slice(1).split('/') : path.split('.');
  return parts.length > 0
    && parts.every((part) => part.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(part));
}

function safeDeclarativePath(path: string): boolean {
  return Boolean(path.trim())
    && path.length <= 1_024
    && !/(?:^|[.[\]/])(?:__proto__|prototype|constructor)(?:$|[.[\]/])/i.test(path);
}

function safeJsonPointer(pointer: string): boolean {
  if (!pointer.startsWith('/') || pointer.length > 2_048) return false;
  return !pointer.split('/').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part));
}

function validateTransport(
  value: unknown,
  origins: Set<string>,
  credentialSlots: Set<string>,
  ids: Set<string>,
  issues: ModelCardValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(blocking('transport-object', 'A transport profile is invalid.'));
    return;
  }
  const transport = value as unknown as TransportProfileV1;
  requireIdentifier(transport.id, 'transport-id', 'Transport ID', issues);
  if (typeof transport.id === 'string') duplicate(transport.id, ids, 'transport-duplicate', 'Transport', issues);
  if (!origins.has(normalizeOrigin(String(transport.approvedOrigin)))) {
    issues.push(blocking('transport-origin', `Transport ${String(transport.id)} must use one exact approved origin.`));
  }
  if (!VALID_TRANSPORT_KINDS.has(String(transport.kind))) {
    issues.push(blocking('transport-kind', `Transport ${String(transport.id)} has an unsupported kind.`));
  }
  if (transport.method !== undefined && !VALID_METHODS.has(String(transport.method))) {
    issues.push(blocking('transport-method', `Transport ${String(transport.id)} has an unsupported HTTP method.`));
  }
  if (transport.bodyKind !== undefined && !VALID_BODY_KINDS.has(String(transport.bodyKind))) {
    issues.push(blocking('transport-body', `Transport ${String(transport.id)} has an unsupported request body type.`));
  }
  if (transport.credentialSlotId && !credentialSlots.has(transport.credentialSlotId)) {
    issues.push(blocking('transport-credential', `Transport ${transport.id} references a missing credential slot.`));
  }
  if (transport.kind === 'built-in') {
    if (!IDENTIFIER.test(transport.builtInEngineId ?? '')) {
      issues.push(blocking('transport-engine', `Built-in transport ${transport.id} needs a registered engine ID.`));
    }
  } else {
    validateRelativePath(transport.endpointPath, 'transport-path', issues);
  }
  if (transport.kind === 'submit-poll') {
    if (!transport.poll) {
      issues.push(blocking('transport-poll', `Submit/poll transport ${transport.id} has no polling relationship.`));
    } else {
      validateRelativePath(transport.poll.statusPath, 'transport-poll-path', issues);
      validateRelativePath(transport.poll.resultPath, 'transport-result-path', issues);
      if (transport.poll.cancelPath) validateRelativePath(transport.poll.cancelPath, 'transport-cancel-path', issues);
      if (transport.poll.intervalMs < 250 || transport.poll.intervalMs > 300_000) {
        issues.push(blocking('transport-poll-interval', `Transport ${transport.id} has an unsafe polling interval.`));
      }
      if (!Number.isFinite(transport.poll.timeoutMs) || transport.poll.timeoutMs < 1_000 || transport.poll.timeoutMs > 86_400_000) {
        issues.push(blocking('transport-poll-timeout', `Transport ${transport.id} has an unsafe polling timeout.`));
      }
      if (
        !Array.isArray(transport.poll.pendingValues)
        || !Array.isArray(transport.poll.successValues)
        || !Array.isArray(transport.poll.failureValues)
        || transport.poll.successValues.length === 0
      ) {
        issues.push(blocking('transport-poll-states', `Transport ${transport.id} needs bounded pending, success, and failure states.`));
      }
    }
  }
  for (const [name, value] of Object.entries(transport.staticHeaders ?? {})) {
    if (FORBIDDEN_HEADERS.has(name.toLowerCase()) || /api[-_]?key|token|secret/i.test(name)) {
      issues.push(blocking('transport-header', `Transport ${transport.id} contains forbidden or credential-like static header ${name}.`));
    }
    if (typeof value !== 'string' || /[\r\n]/.test(value)) {
      issues.push(blocking('transport-header', `Transport ${transport.id} contains an invalid static header value.`));
    }
  }
  const bindings = transport.requestBindings ?? [];
  const boundFields = new Set<string>();
  const boundPaths = new Set<string>();
  for (const binding of bindings) {
    duplicate(binding.fieldId, boundFields, 'transport-binding', 'Transport field binding', issues);
    duplicate(binding.requestPath, boundPaths, 'transport-binding', 'Transport request path', issues);
  }
}

function validateCardLayout(card: FlowModelCardV1, fields: unknown[], outputs: unknown[]): ModelCardValidationIssue[] {
  const issues: ModelCardValidationIssue[] = [];
  const layout = card.layout;
  if (!isRecord(layout) || layout.schemaVersion !== 1) {
    return [blocking('layout-schema', 'Card layout schemaVersion must be 1.', card.id)];
  }
  if (
    typeof layout.width !== 'number'
    || layout.width < CARD_WIDTH_MIN
    || layout.width > CARD_WIDTH_MAX
    || layout.minWidth !== CARD_WIDTH_MIN
    || layout.maxWidth !== CARD_WIDTH_MAX
  ) {
    issues.push({
      ...blocking('layout-width', `Card width must be ${CARD_WIDTH_MIN}–${CARD_WIDTH_MAX}px.`, card.id),
      repair: { id: 'increase-width', label: 'Use a valid card width' },
    });
  }
  const containers = boundedArray(
    layout.containers,
    PROVIDER_PACK_LIMITS.containersPerLayout,
    'container-limit',
    'Layout containers',
    issues,
    card.id,
  );
  const containerIds = new Set<string>();
  for (const container of containers) {
    if (!isRecord(container)) continue;
    requireIdentifier(container.id, 'container-id', 'Container ID', issues, card.id);
    if (typeof container.id === 'string') duplicate(container.id, containerIds, 'container-duplicate', 'Container', issues, card.id);
    if (
      typeof container.columns === 'number'
      && (!Number.isInteger(container.columns) || container.columns < 1 || container.columns > 14)
    ) {
      issues.push(blocking('container-columns', 'Container columns must be between 1 and 14.', card.id));
    }
    if (!VALID_CONTAINER_KINDS.has(String(container.kind))) {
      issues.push(blocking('container-kind', `Container ${String(container.id)} has an unsupported layout kind.`, card.id));
    }
    if (!Number.isFinite(container.order)) {
      issues.push(blocking('container-order', `Container ${String(container.id)} needs a finite layout order.`, card.id));
    }
    if (
      isRecord(container.operationColumns)
      && Object.values(container.operationColumns).some((columns) =>
        !Number.isInteger(Number(columns)) || Number(columns) < 1 || Number(columns) > 14
      )
    ) {
      issues.push(blocking('container-columns', `Container ${String(container.id)} has an invalid operation-specific column count.`, card.id));
    }
  }
  for (const container of containers) {
    if (isRecord(container) && container.parentId && !containerIds.has(String(container.parentId))) {
      issues.push(blocking('container-parent', `Container ${String(container.id)} has a missing parent.`, card.id));
    }
  }
  const elements = boundedArray(
    layout.elements,
    PROVIDER_PACK_LIMITS.elementsPerLayout,
    'element-limit',
    'Layout elements',
    issues,
    card.id,
  );
  const elementIds = new Set<string>();
  const placedFields = new Set<string>();
  const fieldById = new Map(fields.filter(isRecord).map((field) => [String(field.id), field]));
  const outputById = new Map(outputs.filter(isRecord).map((output) => [String(output.id), output]));
  for (const element of elements) {
    if (!isRecord(element)) continue;
    requireIdentifier(element.id, 'element-id', 'Element ID', issues, card.id);
    if (typeof element.id === 'string') duplicate(element.id, elementIds, 'element-duplicate', 'Layout element', issues, card.id);
    if (!containerIds.has(String(element.containerId))) {
      issues.push({
        ...blocking('element-container', `Layout element ${String(element.id)} is outside the card.`, card.id),
        elementId: String(element.id),
        repair: { id: 'move-inside', label: 'Move inside card' },
      });
    }
    if (element.outputId && !outputById.has(String(element.outputId))) {
      issues.push({
        ...blocking('element-output', `Layout element ${String(element.id)} references a missing output.`, card.id),
        outputId: String(element.outputId),
      });
    }
    if ((element.fieldId ? 1 : 0) + (element.outputId ? 1 : 0) !== 1) {
      issues.push(blocking('element-binding', `Layout element ${String(element.id)} must bind exactly one field or output.`, card.id));
    }
    if (element.fieldId) {
      if (!fieldById.has(String(element.fieldId))) {
        issues.push(blocking('element-field', `Layout element ${String(element.id)} references a missing field.`, card.id));
      } else {
        duplicate(String(element.fieldId), placedFields, 'duplicate-layout-binding', 'Placed field', issues, card.id);
      }
    }
    if (element.hidden && element.fieldId && fieldById.get(String(element.fieldId))?.required === true) {
      issues.push({
        ...blocking('required-hidden', `${String(fieldById.get(String(element.fieldId))?.label)} is required and cannot be hidden.`, card.id, String(element.fieldId)),
        elementId: String(element.id),
        repair: { id: 'move-inside', label: 'Show required control' },
      });
    }
    const width = numeric(element.width);
    const height = numeric(element.height);
    if ((width !== undefined && width < 32) || (height !== undefined && height < 32)) {
      issues.push(blocking('minimum-hit-target', `${String(element.id)} is smaller than the 32px minimum interactive target.`, card.id));
    }
    const x = numeric(element.x);
    const y = numeric(element.y);
    const container = containers.find((candidate) => isRecord(candidate) && candidate.id === element.containerId);
    if (
      (x !== undefined && x < 0)
      || (y !== undefined && y < 0)
      || (x !== undefined && width !== undefined && x + width > layout.width)
      || (
        y !== undefined
        && height !== undefined
        && isRecord(container)
        && numeric(container.height) !== undefined
        && y + height > Number(container.height)
      )
    ) {
      issues.push({
        ...blocking('element-clipped', `${String(element.id)} is clipped or outside the card.`, card.id),
        elementId: String(element.id),
        repair: { id: 'move-inside', label: 'Move inside card' },
      });
    }
  }
  const handlePlacements = boundedArray(
    layout.handlePlacements ?? [],
    PROVIDER_PACK_LIMITS.handlesPerLayout,
    'handle-limit',
    'Layout handles',
    issues,
    card.id,
  );
  const placedHandleIds = new Set<string>();
  const handleEdgeOffsets = new Map<string, number[]>();
  for (const placement of handlePlacements) {
    if (!isRecord(placement)) {
      issues.push(blocking('handle-placement', 'A card handle placement is invalid.', card.id));
      continue;
    }
    requireIdentifier(placement.portId, 'handle-port-id', 'Handle port ID', issues, card.id);
    if (typeof placement.portId === 'string') {
      duplicate(placement.portId, placedHandleIds, 'duplicate-handle-placement', 'Handle placement', issues, card.id);
    }
    if (!VALID_HANDLE_ANCHORS.has(String(placement.anchor))) {
      issues.push(blocking('handle-anchor', `${String(placement.portId)} must attach to the card or a control.`, card.id));
    }
    if (!VALID_HANDLE_SIDES.has(String(placement.side))) {
      issues.push(blocking('handle-side', `${String(placement.portId)} must sit on a left, right, top, or bottom edge.`, card.id));
    }
    const offset = numeric(placement.offsetPercent);
    if (offset === undefined || offset < 0 || offset > 100) {
      issues.push(blocking('handle-offset', `${String(placement.portId)} must stay on its selected edge.`, card.id));
    }
    if (placement.anchor === 'element') {
      if (typeof placement.elementId !== 'string' || !elementIds.has(placement.elementId)) {
        issues.push(blocking('handle-element', `${String(placement.portId)} is attached to a missing card control.`, card.id));
      }
    } else if (placement.elementId !== undefined) {
      issues.push(blocking('handle-element', `${String(placement.portId)} cannot name a control while attached to the card.`, card.id));
    }
    if (offset !== undefined && VALID_HANDLE_SIDES.has(String(placement.side))) {
      const edgeKey = `${String(placement.anchor)}:${String(placement.elementId ?? card.id)}:${String(placement.side)}`;
      const edgeOffsets = handleEdgeOffsets.get(edgeKey) ?? [];
      if (edgeOffsets.some((candidate) => Math.abs(candidate - offset) < 2)) {
        issues.push(blocking(
          'handle-collision',
          `${String(placement.portId)} overlaps another handle. Move it along the selected edge.`,
          card.id,
        ));
      }
      edgeOffsets.push(offset);
      handleEdgeOffsets.set(edgeKey, edgeOffsets);
    }
  }
  issues.push(...freeformOverlapIssues(card.id, elements.filter(isRecord) as unknown as CardLayoutElementV1[]));
  return issues;
}

function freeformOverlapIssues(cardId: string, elements: CardLayoutElementV1[]): ModelCardValidationIssue[] {
  const issues: ModelCardValidationIssue[] = [];
  const positioned = elements.filter((element) =>
    [element.x, element.y, element.width, element.height].every((value) => typeof value === 'number')
  );
  for (let left = 0; left < positioned.length; left += 1) {
    for (let right = left + 1; right < positioned.length; right += 1) {
      const a = positioned[left];
      const b = positioned[right];
      if (a.containerId !== b.containerId || a.hidden || b.hidden) continue;
      if (
        Number(a.x) < Number(b.x) + Number(b.width)
        && Number(a.x) + Number(a.width) > Number(b.x)
        && Number(a.y) < Number(b.y) + Number(b.height)
        && Number(a.y) + Number(a.height) > Number(b.y)
      ) {
        issues.push({
          ...blocking('interactive-overlap', `${a.id} overlaps ${b.id}.`, cardId),
          elementId: a.id,
          containerId: a.containerId,
          repair: { id: 'auto-arrange', label: 'Auto Arrange this operation' },
        });
      }
    }
  }
  return issues;
}

export function estimateLayoutHeight(card: FlowModelCardV1, operationId?: string): number {
  const visibleFields = new Set(
    operationId
      ? card.operations.find((operation) => operation.id === operationId)?.visibleFieldIds ?? []
      : card.fields.map((field) => field.id),
  );
  const fieldById = new Map(card.fields.map((field) => [field.id, field]));
  const containerById = new Map(card.layout.containers.map((container) => [container.id, container]));
  let total = 94;
  for (const container of [...card.layout.containers].sort((a, b) => a.order - b.order)) {
    if (container.parentId) continue;
    if (!conditionsApply(container.conditions, operationId)) continue;
    const includedContainerIds = new Set([
      container.id,
      ...(container.kind === 'tabs'
        ? card.layout.containers.filter((candidate) => candidate.parentId === container.id).map((candidate) => candidate.id)
        : []),
    ]);
    const elements = card.layout.elements.filter((element) =>
      includedContainerIds.has(element.containerId)
      && !element.hidden
      && conditionsApply(element.conditions, operationId)
      && (!element.fieldId || visibleFields.has(element.fieldId))
    );
    if (container.collapsedByDefault) {
      total += 38;
      continue;
    }
    if (container.kind === 'freeform' || container.kind === 'pinned-media') {
      total += Math.max(container.height ?? 0, ...elements.map((element) => (element.y ?? 0) + (element.height ?? 42)), 42) + 12;
      continue;
    }
    if (container.kind === 'tabs') {
      const tabGroups = new Map<string, CardLayoutElementV1[]>();
      for (const element of elements) {
        const tabId = containerById.get(element.containerId)?.tabId ?? 'default';
        tabGroups.set(tabId, [...(tabGroups.get(tabId) ?? []), element]);
      }
      total += Math.max(42, ...[...tabGroups.values()].map((items) => items.length * 48)) + 36;
      continue;
    }
    const columns = container.operationColumns?.[operationId ?? ''] ?? container.columns ?? 1;
    const itemCount = elements.reduce((count, element) => {
      const field = element.fieldId ? fieldById.get(element.fieldId) : undefined;
      if (container.kind === 'reference-gallery' && field?.cardinality === 'many') {
        return count + (field.constraints?.maxItems ?? field.constraints?.visiblePortCount ?? 1);
      }
      return count + 1;
    }, 0);
    total += Math.ceil(itemCount / columns) * (
      container.kind === 'reference-gallery'
        ? container.height ?? galleryItemHeightForColumns(columns)
        : 50
    ) + 24;
  }
  return total;
}

function galleryItemHeightForColumns(columns: number): number {
  if (columns >= 4) return 84;
  if (columns === 3) return 92;
  if (columns === 2) return 104;
  return 112;
}

export function validateReleasePolicy(
  pack: ProviderPackV1,
  policy?: ProviderPackReleasePolicyV1,
): ModelCardValidationIssue[] {
  if (!policy) return [];
  const issues: ModelCardValidationIssue[] = [];
  if (policy.lockedPackIds?.includes(pack.packId)) {
    issues.push(blocking('release-policy-pack', `${pack.displayName} is locked by this release policy.`));
  }
  const allowedOrigins = new Set(policy.allowedApprovedOrigins?.map(normalizeOrigin) ?? []);
  if (allowedOrigins.size > 0) {
    for (const approved of pack.approvedOrigins) {
      if (!allowedOrigins.has(normalizeOrigin(approved.origin))) {
        issues.push(blocking('release-policy-origin', `${approved.origin} is not allowed by this release policy.`));
      }
    }
  }
  for (const card of pack.cards) {
    if (policy.lockedCardIds?.includes(card.id)) {
      issues.push(blocking('release-policy-card', `${card.displayName} is locked by this release policy.`, card.id));
    }
    for (const operation of card.operations) {
      if (policy.lockedOperationIds?.includes(operation.id)) {
        issues.push(blocking('release-policy-operation', `${operation.label} is locked by this release policy.`, card.id, undefined, operation.id));
      }
    }
    for (const field of card.fields) {
      if (policy.lockedFieldIds?.includes(field.id)) {
        issues.push(blocking('release-policy-field', `${field.label} is locked by this release policy.`, card.id, field.id));
      }
    }
  }
  return issues;
}

export function isExactApprovedUrl(url: URL, approvedOrigin: string): boolean {
  return url.origin === normalizeOrigin(approvedOrigin)
    && !url.username
    && !url.password
    && (url.protocol === 'https:' || (url.protocol === 'http:' && isPrivateHost(url.hostname)));
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = /^172\.(\d+)\./.exec(host);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function inspectHostileJson(value: unknown): void {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (depth > 64 || nodes > 2_000_000) {
      throw new ProviderPackImportError('Provider pack is too deeply nested or structurally complex.');
    }
    if (typeof candidate === 'string') {
      if (candidate.length > PROVIDER_PACK_LIMITS.stringLength) {
        throw new ProviderPackImportError('Provider pack contains a string longer than 16,384 characters.');
      }
      if (/^\s*(?:javascript|data:text\/html):/i.test(candidate)) {
        throw new ProviderPackImportError('Provider pack contains an executable URL.');
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const [key, item] of Object.entries(candidate)) {
      if (FORBIDDEN_IMPORT_KEYS.has(key.toLowerCase())) {
        throw new ProviderPackImportError(`Provider pack contains unsupported executable field "${key}".`);
      }
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
}

function validateApprovedOrigin(value: string, allowPrivateHttp: boolean): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && allowPrivateHttp && isPrivateHost(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

function validateRelativePath(value: unknown, code: string, issues: ModelCardValidationIssue[]): void {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    issues.push(blocking(code, 'Transport and discovery paths must be relative paths beginning with one slash.'));
  }
}

function validateOptionalHttpUrl(value: unknown, code: string, label: string, issues: ModelCardValidationIssue[]): void {
  if (value === undefined) return;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    issues.push(blocking(code, `${label} must be an HTTP(S) URL without embedded credentials.`));
  }
}

function requireIdentifier(
  value: unknown,
  code: string,
  label: string,
  issues: ModelCardValidationIssue[],
  cardId?: string,
): void {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    issues.push(blocking(code, `${label} is missing or contains unsupported characters.`, cardId));
  }
}

function requireString(
  value: unknown,
  code: string,
  label: string,
  issues: ModelCardValidationIssue[],
  cardId?: string,
): void {
  if (typeof value !== 'string' || !value.trim() || value.length > PROVIDER_PACK_LIMITS.stringLength) {
    issues.push(blocking(code, `${label} is missing or too long.`, cardId));
  }
}

function boundedArray(
  value: unknown,
  limit: number,
  code: string,
  label: string,
  issues: ModelCardValidationIssue[],
  cardId?: string,
): unknown[] {
  if (!Array.isArray(value)) {
    issues.push(blocking(code, `${label} must be an array.`, cardId));
    return [];
  }
  if (value.length > limit) {
    issues.push(blocking(code, `${label} exceeds the ${limit.toLocaleString()} item limit.`, cardId));
    return value.slice(0, limit);
  }
  return value;
}

function duplicate(
  value: string,
  values: Set<string>,
  code: string,
  label: string,
  issues: ModelCardValidationIssue[],
  cardId?: string,
): void {
  if (values.has(value)) issues.push(blocking(code, `${label} ${value} is duplicated.`, cardId));
  values.add(value);
}

function blocking(
  code: string,
  message: string,
  cardId?: string,
  fieldId?: string,
  operationId?: string,
): ModelCardValidationIssue {
  return { code, severity: 'blocking', message, cardId, fieldId, operationId };
}

function invalid(code: string, message: string): ProviderPackValidationResult {
  return { validStructure: false, activatable: false, issues: [blocking(code, message)] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function positiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function conditionsApply(
  conditions: { operationIds?: string[] }[] | undefined,
  operationId: string | undefined,
): boolean {
  return !conditions?.some((condition) =>
    condition.operationIds && operationId && !condition.operationIds.includes(operationId)
  );
}
