import { BUNDLED_PROVIDER_PACKS } from './bundledProviderPacks';
import { generateAutomaticCardLayout } from './providerCardLayout';
import {
  type CredentialAuthTypeV1,
  type FieldValueTypeV1,
  type FlowModelCardV1,
  type ModelCardConfidence,
  type ModelFieldSemanticRoleV1,
  type ModelFieldV1,
  type ModelModalityV1,
  type ProviderPackV1,
} from './providerPackContracts';
import { hashProviderPack, importProviderPack } from './providerPackPortability';
import { isExactApprovedUrl } from './providerPackValidation';

const DISCOVERY_RESPONSE_LIMIT = 10 * 1024 * 1024;

export interface ProviderDiscoveryInput {
  baseEndpoint: string;
  providerName?: string;
  authentication?: {
    type: CredentialAuthTypeV1;
    value?: string;
    headerName?: string;
  };
  approvedOrigin?: string;
  schemaText?: string;
  schemaUrl?: string;
  documentationUrl?: string;
  sampleRequest?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface DiscoveredModelSummary {
  card: FlowModelCardV1;
  confidence: ModelCardConfidence;
  source:
    | 'sloom-manifest'
    | 'advertised-schema'
    | 'openapi'
    | 'json-schema'
    | 'known-profile'
    | 'model-list'
    | 'sample-request'
    | 'manual';
  notes: string[];
}

export interface ProviderDiscoveryResult {
  pack: ProviderPackV1;
  hash: string;
  models: DiscoveredModelSummary[];
  attempts: Array<{ step: string; status: 'used' | 'empty' | 'failed'; message: string }>;
  redactedRequestPreview: string;
}

export interface ParsedSampleRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  redactedPreview: string;
}

export async function discoverProvider(
  input: ProviderDiscoveryInput,
): Promise<ProviderDiscoveryResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseEndpoint(input.baseEndpoint);
  const approvedOrigin = input.approvedOrigin
    ? new URL(input.approvedOrigin).origin
    : baseUrl.origin;
  if (baseUrl.origin !== approvedOrigin) {
    throw new Error('The base endpoint must use the exact origin approved by the user.');
  }
  const attempts: ProviderDiscoveryResult['attempts'] = [];
  const credentialHeader = authenticationHeader(input.authentication);
  const exactOriginHeaders = (url: URL): HeadersInit =>
    isExactApprovedUrl(url, approvedOrigin) ? credentialHeader : {};

  const manifestUrl = new URL('/.well-known/sloom-provider.json', baseUrl.origin);
  try {
    const response = await fetchImpl(manifestUrl, {
      headers: exactOriginHeaders(manifestUrl),
      redirect: 'error',
      signal: input.signal,
    });
    if (response.ok) {
      const text = await readBoundedText(response);
      const { pack, hash } = importProviderPack(text);
      attempts.push({ step: 'Sloom provider manifest', status: 'used', message: `Loaded ${pack.cards.length} model cards.` });
      return {
        pack,
        hash,
        models: pack.cards.map((card) => ({
          card,
          confidence: 'provider-verified',
          source: 'sloom-manifest',
          notes: ['The provider supplied a native Sloom provider manifest.'],
        })),
        attempts,
        redactedRequestPreview: `GET ${manifestUrl.toString()}\nAuthorization: [redacted if configured]`,
      };
    }
    attempts.push({ step: 'Sloom provider manifest', status: 'empty', message: `No manifest (${response.status}).` });
  } catch (error) {
    attempts.push({ step: 'Sloom provider manifest', status: 'failed', message: safeError(error) });
  }

  const advertisedSchemaUrls = new Set<string>();
  if (input.schemaUrl) advertisedSchemaUrls.add(new URL(input.schemaUrl, baseUrl).toString());
  try {
    const response = await fetchImpl(baseUrl, {
      headers: exactOriginHeaders(baseUrl),
      redirect: 'error',
      signal: input.signal,
    });
    const link = response.headers.get('link') ?? '';
    for (const match of link.matchAll(/<([^>]+)>\s*;\s*rel="?[^"]*(?:service-desc|describedby|schema)[^"]*"?/gi)) {
      advertisedSchemaUrls.add(new URL(match[1], baseUrl).toString());
    }
  } catch {
    // The explicit metadata steps below remain available.
  }
  for (const schemaUrlText of advertisedSchemaUrls) {
    try {
      const schemaUrl = new URL(schemaUrlText);
      const response = await fetchImpl(schemaUrl, {
        // Cross-origin schemas are deliberately fetched without credentials.
        headers: exactOriginHeaders(schemaUrl),
        redirect: 'error',
        signal: input.signal,
      });
      if (!response.ok) continue;
      const schemaText = await readBoundedText(response);
      const parsed = parseSchemaText(schemaText);
      if (!parsed) continue;
      const pack = buildPackFromSchema(parsed, {
        baseUrl,
        approvedOrigin,
        providerName: input.providerName,
        documentationUrl: input.documentationUrl,
        authentication: input.authentication,
      });
      attempts.push({ step: 'Provider-advertised schema', status: 'used', message: `Built ${pack.cards.length} draft cards from ${schemaUrl.origin}.` });
      return discoveryResult(pack, attempts, 'advertised-schema', schemaUrl, Boolean(input.authentication?.value));
    } catch (error) {
      attempts.push({ step: 'Provider-advertised schema', status: 'failed', message: safeError(error) });
    }
  }
  if (advertisedSchemaUrls.size === 0) {
    attempts.push({ step: 'Provider-advertised schema', status: 'empty', message: 'No schema link was advertised.' });
  }

  if (input.schemaText) {
    const parsed = parseSchemaText(input.schemaText);
    if (parsed) {
      const pack = buildPackFromSchema(parsed, {
        baseUrl,
        approvedOrigin,
        providerName: input.providerName,
        documentationUrl: input.documentationUrl,
        authentication: input.authentication,
      });
      attempts.push({ step: 'OpenAPI or JSON Schema', status: 'used', message: `Built ${pack.cards.length} draft cards from the supplied schema.` });
      return discoveryResult(pack, attempts, isOpenApi(parsed) ? 'openapi' : 'json-schema', baseUrl, Boolean(input.authentication?.value));
    }
    attempts.push({ step: 'OpenAPI or JSON Schema', status: 'failed', message: 'The supplied schema is not JSON OpenAPI 3.0/3.1 or JSON Schema.' });
  } else {
    attempts.push({ step: 'OpenAPI or JSON Schema', status: 'empty', message: 'No schema file was supplied.' });
  }

  const known = BUNDLED_PROVIDER_PACKS.find((pack) =>
    pack.approvedOrigins.some((entry) => new URL(entry.origin).origin === approvedOrigin)
  );
  if (known) {
    const pack = {
      ...clone(known),
      packId: localPackId(input.providerName ?? known.provider.name, approvedOrigin),
      version: '1.0.0',
      displayName: input.providerName ? `${input.providerName} provider pack` : known.displayName,
    };
    attempts.push({ step: 'Known provider profile', status: 'used', message: `Recognized ${known.provider.name} and loaded ${known.cards.length} cards.` });
    return discoveryResult(pack, attempts, 'known-profile', baseUrl, Boolean(input.authentication?.value));
  }
  attempts.push({ step: 'Known provider profile', status: 'empty', message: 'No bundled origin profile matched.' });

  for (const path of ['/v1/models', '/models']) {
    const modelsUrl = new URL(path, baseUrl.origin);
    try {
      const response = await fetchImpl(modelsUrl, {
        headers: exactOriginHeaders(modelsUrl),
        redirect: 'error',
        signal: input.signal,
      });
      if (!response.ok) continue;
      const json = JSON.parse(await readBoundedText(response)) as unknown;
      const models = modelIdsFromResponse(json);
      if (!models.length) continue;
      const pack = buildPackFromModelIds(models, {
        baseUrl,
        approvedOrigin,
        providerName: input.providerName,
        documentationUrl: input.documentationUrl,
        authentication: input.authentication,
      });
      attempts.push({ step: 'Model list endpoint', status: 'used', message: `Found ${models.length} model IDs at ${path}.` });
      return discoveryResult(pack, attempts, 'model-list', modelsUrl, Boolean(input.authentication?.value));
    } catch (error) {
      attempts.push({ step: `Model list ${path}`, status: 'failed', message: safeError(error) });
    }
  }
  attempts.push({ step: 'Model list endpoint', status: 'empty', message: 'No compatible /v1/models or /models response was found.' });

  if (input.sampleRequest) {
    try {
      const sample = parseSampleRequest(input.sampleRequest, baseUrl);
      if (new URL(sample.url).origin !== approvedOrigin) {
        throw new Error('The sample request uses an origin that was not approved.');
      }
      const pack = buildPackFromSample(sample, {
        baseUrl,
        approvedOrigin,
        providerName: input.providerName,
        documentationUrl: input.documentationUrl,
        authentication: input.authentication,
      });
      attempts.push({ step: 'Sample request', status: 'used', message: 'Built one inferred draft card from the request fields.' });
      return {
        ...discoveryResult(pack, attempts, 'sample-request', new URL(sample.url), Boolean(input.authentication?.value)),
        redactedRequestPreview: sample.redactedPreview,
      };
    } catch (error) {
      attempts.push({ step: 'Sample request', status: 'failed', message: safeError(error) });
    }
  } else {
    attempts.push({ step: 'Sample request', status: 'empty', message: 'No sample cURL or JSON request was supplied.' });
  }

  const pack = buildManualPack({
    baseUrl,
    approvedOrigin,
    providerName: input.providerName,
    documentationUrl: input.documentationUrl,
    authentication: input.authentication,
  });
  attempts.push({ step: 'Manual definition', status: 'used', message: 'Created a safe manual draft with Prompt and primary output placeholders.' });
  return discoveryResult(pack, attempts, 'manual', baseUrl, Boolean(input.authentication?.value));
}

export function parseSampleRequest(text: string, defaultBase?: URL): ParsedSampleRequest {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Sample request is empty.');
  if (/[`]|\$\(|<\(|>\(|\n\s*(?:rm|bash|sh|zsh|powershell|cmd)\b/i.test(trimmed)) {
    throw new Error('The sample contains shell execution syntax. Sloom parses request text only.');
  }
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed) || typeof parsed.url !== 'string') {
      throw new Error('JSON samples need a url and may include method, headers, and body.');
    }
    const url = new URL(parsed.url, defaultBase).toString();
    const headers = safeSampleHeaders(parsed.headers);
    const method = httpMethod(parsed.method);
    const body = parsed.body;
    return { method, url, headers, body, redactedPreview: renderSamplePreview(method, url, headers, body) };
  }

  const tokens = tokenizeShellText(trimmed);
  if (tokens[0]?.toLowerCase() !== 'curl') throw new Error('Sample text must be a cURL command or JSON request object.');
  let method: ParsedSampleRequest['method'] = 'GET';
  let urlText = '';
  const headers: Record<string, string> = {};
  let bodyText: string | undefined;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (['-x', '--request'].includes(token.toLowerCase())) {
      method = httpMethod(tokens[++index]);
    } else if (['-h', '--header'].includes(token.toLowerCase())) {
      const header = tokens[++index] ?? '';
      const split = header.indexOf(':');
      if (split > 0) headers[header.slice(0, split).trim()] = header.slice(split + 1).trim();
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(token.toLowerCase())) {
      bodyText = tokens[++index];
      if (bodyText?.startsWith('@')) throw new Error('Sample requests cannot read local files.');
      if (method === 'GET') method = 'POST';
    } else if (token.startsWith('-')) {
      if (['--url'].includes(token.toLowerCase())) urlText = tokens[++index] ?? '';
      else if (['-o', '--output', '-k', '--insecure', '-l', '--location'].includes(token.toLowerCase())) {
        if (['-o', '--output'].includes(token.toLowerCase())) index += 1;
      }
    } else if (!urlText) {
      urlText = token;
    }
  }
  if (!urlText) throw new Error('Sample cURL request has no URL.');
  const url = new URL(urlText, defaultBase).toString();
  const safeHeaders = safeSampleHeaders(headers);
  const body = bodyText ? parsePossibleJson(bodyText) : undefined;
  return { method, url, headers: safeHeaders, body, redactedPreview: renderSamplePreview(method, url, safeHeaders, body) };
}

function buildPackFromSchema(
  schema: Record<string, unknown>,
  context: BuilderContext,
): ProviderPackV1 {
  if (isOpenApi(schema)) {
    const cards: FlowModelCardV1[] = [];
    const paths = isRecord(schema.paths) ? schema.paths : {};
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!isRecord(pathItem)) continue;
      for (const method of ['post', 'get', 'put', 'patch'] as const) {
        const operation = pathItem[method];
        if (!isRecord(operation)) continue;
        const operationId = safeId(String(operation.operationId ?? `${method}-${path}`));
        const requestSchema = requestSchemaFromOpenApi(operation, schema);
        const fields = fieldsFromJsonSchema(requestSchema, [operationId]);
        const modality = inferOutputModality(operation, path);
        cards.push(createDiscoveredCard({
          id: `model:${operationId}`,
          modelId: String(operation['x-model-id'] ?? operationId),
          displayName: String(operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`),
          operationId,
          endpointPath: path,
          method: method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH',
          fields,
          modality,
          confidence: 'provider-verified',
          description: typeof operation.description === 'string' ? operation.description : undefined,
        }));
      }
    }
    return basePack(context, cards.length ? cards : [schemaFallbackCard(schema)], 'openapi-runtime');
  }
  const fields = fieldsFromJsonSchema(schema, ['generate']);
  return basePack(context, [createDiscoveredCard({
    id: 'model:discovered',
    modelId: String(schema.title ?? 'discovered-model'),
    displayName: String(schema.title ?? 'Discovered model'),
    operationId: 'generate',
    endpointPath: context.baseUrl.pathname === '/' ? '/v1/generate' : context.baseUrl.pathname,
    method: 'POST',
    fields,
    modality: inferModalityFromSchema(schema),
    confidence: 'provider-verified',
    description: typeof schema.description === 'string' ? schema.description : undefined,
  })], 'json-schema-runtime');
}

function buildPackFromModelIds(models: string[], context: BuilderContext): ProviderPackV1 {
  return basePack(
    context,
    models.map((modelId) => createDiscoveredCard({
      id: `model:${safeId(modelId)}`,
      modelId,
      displayName: labelFromId(modelId),
      operationId: 'generate',
      endpointPath: '/v1/generate',
      method: 'POST',
      fields: [promptField(['generate'])],
      modality: inferModalityFromId(modelId),
      confidence: 'inferred',
      description: 'Only the model ID was discovered. Confirm endpoint, fields, and output before activation.',
    })),
    'model-list-runtime',
  );
}

function buildPackFromSample(sample: ParsedSampleRequest, context: BuilderContext): ProviderPackV1 {
  const body = isRecord(sample.body) ? sample.body : {};
  const fields = Object.entries(body).map(([key, value]) => fieldFromSample(key, value, ['generate']));
  if (!fields.some((field) => field.semanticRole === 'prompt')) fields.unshift(promptField(['generate']));
  const path = new URL(sample.url).pathname;
  return basePack(context, [createDiscoveredCard({
    id: 'model:sample-request',
    modelId: typeof body.model === 'string' ? body.model : 'sample-request-model',
    displayName: typeof body.model === 'string' ? labelFromId(body.model) : 'Sample request model',
    operationId: 'generate',
    endpointPath: path,
    method: sample.method,
    fields,
    modality: inferModalityFromId(`${String(body.model ?? '')} ${path}`),
    confidence: 'inferred',
    description: 'Inferred from a safely parsed request. Verify the output mapping before activation.',
  })], 'sample-runtime');
}

function buildManualPack(context: BuilderContext): ProviderPackV1 {
  return basePack(context, [createDiscoveredCard({
    id: 'model:manual',
    modelId: 'manual-model',
    displayName: 'Manual model',
    operationId: 'generate',
    endpointPath: context.baseUrl.pathname === '/' ? '/v1/generate' : context.baseUrl.pathname,
    method: 'POST',
    fields: [promptField(['generate'])],
    modality: 'image',
    confidence: 'manual',
    description: 'Complete the endpoint, request fields, and output mapping in the card builder.',
    draft: true,
  })], 'manual-runtime');
}

interface BuilderContext {
  baseUrl: URL;
  approvedOrigin: string;
  providerName?: string;
  documentationUrl?: string;
  authentication?: ProviderDiscoveryInput['authentication'];
}

function basePack(
  context: BuilderContext,
  cards: FlowModelCardV1[],
  transportId: string,
): ProviderPackV1 {
  const authType = context.authentication?.type ?? 'none';
  const credentialSlots = authType === 'none' ? [] : [{
    id: 'default',
    label: `${context.providerName ?? context.baseUrl.hostname} credential`,
    authType,
    approvedOrigin: context.approvedOrigin,
    headerName: context.authentication?.headerName,
    required: true,
  }];
  const transports: ProviderPackV1['transports'] = [];
  const routesBySignature = new Map<string, string>();
  const acceptedCards: FlowModelCardV1[] = [];
  for (const card of cards) {
    const plannedRoutes: Array<{ operation: FlowModelCardV1['operations'][number]; signature: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' }> = [];
    let introducesTooManyRoutes = false;
    for (const operation of card.operations) {
    const methodSuffix = operation.transportProfileId.split(':').at(-1)?.toUpperCase();
    const method = ['GET', 'POST', 'PUT', 'PATCH'].includes(methodSuffix ?? '')
      ? methodSuffix as 'GET' | 'POST' | 'PUT' | 'PATCH'
      : 'POST';
      const signature = JSON.stringify({
        method,
        endpointPath: operation.endpointPath ?? '/v1/generate',
        requestBindings: operation.requestBindings ?? [],
        outputExtractions: operation.outputExtractions ?? [],
      });
      if (!routesBySignature.has(signature) && routesBySignature.size + plannedRoutes.filter((entry) =>
        !routesBySignature.has(entry.signature) && entry.signature !== signature
      ).length >= 128) {
        introducesTooManyRoutes = true;
        break;
      }
      plannedRoutes.push({ operation, signature, method });
    }
    if (introducesTooManyRoutes) continue;
    for (const { operation, signature, method } of plannedRoutes) {
      let routeId = routesBySignature.get(signature);
      if (!routeId) {
        routeId = `${transportId}:${transports.length + 1}`;
        routesBySignature.set(signature, routeId);
        transports.push({
      id: routeId,
      label: `${card.displayName} · ${operation.label}`,
      kind: 'http' as const,
      approvedOrigin: context.approvedOrigin,
      credentialSlotId: credentialSlots[0]?.id,
      method,
      endpointPath: operation.endpointPath ?? '/v1/generate',
      bodyKind: 'json' as const,
      requestBindings: operation.requestBindings,
      outputExtractions: operation.outputExtractions,
      timeoutMs: 120_000,
        });
      }
      operation.transportProfileId = routeId;
    }
    acceptedCards.push(card);
  }
  return {
    schemaVersion: 1,
    packId: localPackId(context.providerName ?? context.baseUrl.hostname, context.approvedOrigin),
    version: '1.0.0',
    displayName: `${context.providerName ?? context.baseUrl.hostname} provider pack`,
    provider: {
      name: context.providerName ?? context.baseUrl.hostname,
      documentationUrl: context.documentationUrl,
    },
    approvedOrigins: [{
      origin: context.approvedOrigin,
      allowPlainHttpPrivateNetwork: context.baseUrl.protocol === 'http:',
    }],
    credentialSlots,
    discovery: [
      { id: 'sloom-manifest', kind: 'sloom-manifest', path: '/.well-known/sloom-provider.json', method: 'GET' },
      { id: 'models', kind: 'model-list', path: '/v1/models', method: 'GET', credentialSlotId: credentialSlots[0]?.id, modelListPointer: '/data' },
    ],
    optionCatalogs: [],
    transports,
    cards: acceptedCards,
    release: {
      sourceDocumentationUrls: context.documentationUrl ? [context.documentationUrl] : [],
    },
  };
}

function createDiscoveredCard(input: {
  id: string;
  modelId: string;
  displayName: string;
  operationId: string;
  endpointPath: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  fields: ModelFieldV1[];
  modality: ModelModalityV1;
  confidence: ModelCardConfidence;
  description?: string;
  draft?: boolean;
}): FlowModelCardV1 {
  const outputId = `${input.modality}-output`;
  const base: Omit<FlowModelCardV1, 'layout'> = {
    schemaVersion: 1,
    id: input.id,
    modelId: input.modelId,
    displayName: input.displayName,
    description: input.description,
    modalities: [input.modality],
    fields: input.fields,
    outputs: [{
      id: outputId,
      label: `${capitalize(input.modality)} output`,
      semanticRole: `${input.modality}-output`,
      resultType: input.modality,
      primary: true,
      cardinality: 'one',
      operationIds: [input.operationId],
    }],
    operations: [{
      id: input.operationId,
      label: capitalize(input.operationId.replaceAll('-', ' ')),
      transportProfileId: `pending:${input.method.toLowerCase()}`,
      requiredFieldIds: input.fields.filter((field) => field.required).map((field) => field.id),
      visibleFieldIds: input.fields.map((field) => field.id),
      inputPortFieldIds: input.fields.filter((field) => field.connectable).map((field) => field.id),
      outputIds: [outputId],
      endpointPath: input.endpointPath,
      requestBindings: input.fields.map((field) => ({
        fieldId: field.id,
        requestPath: field.apiPath,
        omitWhenEmpty: !field.required,
        encoding: field.encoding,
      })),
      outputExtractions: [{ outputId, kind: 'json-pointer', pointer: `/data/0/${input.modality === 'text' ? 'text' : 'url'}` }],
    }],
    evidence: [],
    confidence: input.confidence,
    status: input.draft ? 'draft' : 'ready-untested',
  };
  return {
    ...base,
    layout: generateAutomaticCardLayout(base, {
      width: 390,
      fitTarget: '1080p',
      heightBudget: 900,
    }),
  };
}

function fieldsFromJsonSchema(schema: unknown, operationIds: string[]): ModelFieldV1[] {
  if (!isRecord(schema)) return [promptField(operationIds)];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []);
  const fields = Object.entries(properties).map(([name, definition]) =>
    fieldFromSchema(name, definition, required.has(name), operationIds)
  );
  return fields.length ? fields : [promptField(operationIds)];
}

function fieldFromSchema(
  name: string,
  definition: unknown,
  required: boolean,
  operationIds: string[],
): ModelFieldV1 {
  const schema = isRecord(definition) ? definition : {};
  const role = semanticRoleFromName(name);
  const type = valueTypeFromSchema(schema, role);
  const arrayItems = isRecord(schema.items) ? schema.items : {};
  const enumValues = Array.isArray(schema.enum) ? schema.enum : Array.isArray(arrayItems.enum) ? arrayItems.enum : [];
  return {
    id: safeId(name),
    label: typeof schema.title === 'string' ? schema.title : labelFromId(name),
    description: typeof schema.description === 'string' ? schema.description : undefined,
    apiPath: name,
    semanticRole: role,
    valueType: type,
    cardinality: schema.type === 'array' ? 'many' : 'one',
    required,
    connectable: connectableRole(role),
    constraints: {
      min: numeric(schema.minimum),
      max: numeric(schema.maximum),
      step: numeric(schema.multipleOf),
      minItems: numeric(schema.minItems),
      maxItems: numeric(schema.maxItems),
      visiblePortCount: schema.type === 'array' ? numeric(schema.maxItems) : undefined,
      minLength: numeric(schema.minLength),
      maxLength: numeric(schema.maxLength),
    },
    encoding: connectableRole(role) && type !== 'string' ? 'base64' : 'json',
    options: enumValues.map((value) => ({ value: String(value), label: labelFromId(String(value)) })),
    defaultValue: schema.default,
    operationIds,
    control: controlFromSchema(schema, role),
    advanced: role === 'advanced',
  };
}

function fieldFromSample(name: string, value: unknown, operationIds: string[]): ModelFieldV1 {
  return fieldFromSchema(name, {
    type: Array.isArray(value) ? 'array' : typeof value,
    ...(Array.isArray(value) ? { maxItems: Math.max(1, value.length) } : {}),
    default: redactSampleValue(name, value),
  }, false, operationIds);
}

function promptField(operationIds: string[]): ModelFieldV1 {
  return {
    id: 'prompt',
    label: 'Prompt',
    apiPath: 'prompt',
    semanticRole: 'prompt',
    valueType: 'string',
    cardinality: 'one',
    required: true,
    connectable: true,
    encoding: 'json',
    operationIds,
    control: 'prompt',
  };
}

function requestSchemaFromOpenApi(
  operation: Record<string, unknown>,
  document: Record<string, unknown>,
): unknown {
  if (!isRecord(operation.requestBody)) return {};
  const body = resolveRef(operation.requestBody, document);
  if (!isRecord(body) || !isRecord(body.content)) return {};
  for (const mediaType of ['application/json', 'multipart/form-data', 'application/octet-stream']) {
    const media = body.content[mediaType];
    if (isRecord(media) && media.schema) return resolveRef(media.schema, document);
  }
  return {};
}

function resolveRef(value: unknown, document: Record<string, unknown>): unknown {
  if (!isRecord(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value;
  return value.$ref.slice(2).split('/').reduce<unknown>((current, segment) =>
    isRecord(current) ? current[segment.replaceAll('~1', '/').replaceAll('~0', '~')] : undefined
  , document);
}

function schemaFallbackCard(schema: Record<string, unknown>): FlowModelCardV1 {
  return createDiscoveredCard({
    id: 'model:openapi-manual',
    modelId: 'openapi-manual',
    displayName: String(isRecord(schema.info) ? schema.info.title ?? 'OpenAPI model' : 'OpenAPI model'),
    operationId: 'generate',
    endpointPath: '/v1/generate',
    method: 'POST',
    fields: [promptField(['generate'])],
    modality: 'image',
    confidence: 'inferred',
    draft: true,
  });
}

function parseSchemaText(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isOpenApi(schema: Record<string, unknown>): boolean {
  return typeof schema.openapi === 'string' && /^3\.[01](?:\.|$)/.test(schema.openapi);
}

function modelIdsFromResponse(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : isRecord(value) && Array.isArray(value.models)
        ? value.models
        : [];
  return [...new Set(candidates.map((candidate) =>
    typeof candidate === 'string'
      ? candidate
      : isRecord(candidate) && typeof candidate.id === 'string'
        ? candidate.id
        : ''
  ).filter(Boolean))].slice(0, 2_000);
}

function authenticationHeader(authentication: ProviderDiscoveryInput['authentication']): HeadersInit {
  const value = authentication?.value?.trim();
  if (!value) return {};
  if (authentication?.type === 'bearer') return { Authorization: `Bearer ${value}` };
  if (authentication?.type === 'api-key-header') return { [authentication.headerName ?? 'x-api-key']: value };
  if (authentication?.type === 'basic') return { Authorization: `Basic ${value}` };
  return {};
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > DISCOVERY_RESPONSE_LIMIT) throw new Error('Discovery response exceeds 10 MiB.');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > DISCOVERY_RESPONSE_LIMIT) throw new Error('Discovery response exceeds 10 MiB.');
  return text;
}

function discoveryResult(
  pack: ProviderPackV1,
  attempts: ProviderDiscoveryResult['attempts'],
  source: DiscoveredModelSummary['source'],
  requestUrl: URL,
  credentialConfigured: boolean,
): ProviderDiscoveryResult {
  return {
    pack,
    hash: hashProviderPack(pack),
    models: pack.cards.map((card) => ({
      card,
      confidence: source === 'known-profile' ? 'sloom-recognized' : card.confidence,
      source,
      notes: card.status === 'draft'
        ? ['Saved as a draft. Complete blocking request and output details before activation.']
        : card.confidence === 'inferred'
          ? ['Inferred—please check request fields, operation routing, and primary output.']
          : [],
    })),
    attempts,
    redactedRequestPreview: `GET ${requestUrl.toString()}\n${credentialConfigured ? 'Authorization: [redacted]' : 'No credential header'}`,
  };
}

function tokenizeShellText(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (quote) throw new Error('Sample request contains an unclosed quote.');
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function safeSampleHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === 'string')
      .map(([name, item]) => [
        name,
        /authorization|api[-_]?key|token|secret|cookie/i.test(name) ? '[redacted]' : String(item),
      ]),
  );
}

function renderSamplePreview(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): string {
  const redactedUrl = new URL(url);
  for (const key of [...redactedUrl.searchParams.keys()]) {
    if (/key|token|secret|password/i.test(key)) redactedUrl.searchParams.set(key, '[redacted]');
  }
  return [
    `${method} ${redactedUrl.toString()}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    body === undefined ? '' : JSON.stringify(redactObject(body), null, 2),
  ].filter(Boolean).join('\n');
}

function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /key|token|secret|password|authorization/i.test(key) ? '[redacted]' : redactObject(item),
  ]));
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Discovery step failed.')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/((?:key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]');
}

function normalizeBaseEndpoint(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Provider endpoint must be HTTP(S) and cannot contain credentials.');
  }
  return url;
}

function semanticRoleFromName(name: string): ModelFieldSemanticRoleV1 {
  const key = name.toLowerCase();
  if (/system/.test(key)) return 'system-instruction';
  if (/mask/.test(key)) return 'mask';
  if (/reference.*image|images|refs/.test(key)) return 'reference-image';
  if (/source.*image|input.*image|^image$/.test(key)) return 'source-image';
  if (/start.*frame/.test(key)) return 'start-frame';
  if (/end.*frame/.test(key)) return 'end-frame';
  if (/source.*video|^video$/.test(key)) return 'source-video';
  if (/source.*audio|^audio$/.test(key)) return 'source-audio';
  if (/script/.test(key)) return 'script';
  if (/voice/.test(key)) return 'voice';
  if (/duration/.test(key)) return 'duration';
  if (/fps|frame.*rate/.test(key)) return 'frame-rate';
  if (/width/.test(key)) return 'width';
  if (/height/.test(key)) return 'height';
  if (/resolution|size/.test(key)) return 'resolution';
  if (/format|mime/.test(key)) return 'format';
  if (/seed/.test(key)) return 'seed';
  if (/count|quantity|^n$/.test(key)) return 'quantity';
  if (/prompt|input|contents/.test(key)) return 'prompt';
  return 'advanced';
}

function valueTypeFromSchema(
  schema: Record<string, unknown>,
  role: ModelFieldSemanticRoleV1,
): FieldValueTypeV1 {
  if (['source-image', 'mask', 'reference-image', 'start-frame', 'end-frame'].includes(role)) return 'image';
  if (role === 'source-video') return 'video';
  if (role === 'source-audio') return 'audio';
  if (Array.isArray(schema.enum)) return 'enum';
  if (schema.type === 'integer') return 'integer';
  if (schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'object' || schema.type === 'array') return 'json';
  return 'string';
}

function controlFromSchema(
  schema: Record<string, unknown>,
  role: ModelFieldSemanticRoleV1,
): ModelFieldV1['control'] {
  if (role === 'prompt') return 'prompt';
  if (role === 'reference-image') return 'reference-gallery';
  if (connectableRole(role) && !['prompt', 'script'].includes(role)) return 'media';
  if (Array.isArray(schema.enum)) return 'dropdown';
  if (schema.type === 'boolean') return 'toggle';
  if (['number', 'integer'].includes(String(schema.type)) && schema.minimum !== undefined && schema.maximum !== undefined) return 'slider';
  if (['number', 'integer'].includes(String(schema.type))) return 'number';
  if (role === 'advanced') return 'advanced-value';
  return 'text';
}

function connectableRole(role: ModelFieldSemanticRoleV1): boolean {
  return [
    'prompt',
    'context',
    'media-context',
    'source-image',
    'mask',
    'reference-image',
    'control-image',
    'source-video',
    'start-frame',
    'end-frame',
    'reference-video',
    'script',
    'source-audio',
  ].includes(role);
}

function inferOutputModality(operation: Record<string, unknown>, path: string): ModelModalityV1 {
  return inferModalityFromId(`${String(operation.operationId ?? '')} ${String(operation.summary ?? '')} ${path}`);
}

function inferModalityFromSchema(schema: Record<string, unknown>): ModelModalityV1 {
  return inferModalityFromId(`${String(schema.title ?? '')} ${String(schema.description ?? '')}`);
}

function inferModalityFromId(value: string): ModelModalityV1 {
  const normalized = value.toLowerCase();
  if (/video|veo|wan|ltx|mochi/.test(normalized)) return 'video';
  if (/audio|speech|voice|tts|music|sound/.test(normalized)) return 'audio';
  if (/text|chat|completion|language|llm|gpt(?!-image)/.test(normalized)) return 'text';
  return 'image';
}

function httpMethod(value: unknown): ParsedSampleRequest['method'] {
  const method = String(value ?? 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) {
    throw new Error(`Unsupported request method ${method}.`);
  }
  return method as ParsedSampleRequest['method'];
}

function parsePossibleJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function redactSampleValue(name: string, value: unknown): unknown {
  return /key|token|secret|password|authorization/i.test(name) ? undefined : value;
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 240) || 'item';
}

function localPackId(name: string, origin: string): string {
  return `local.${safeId(name)}.${hashText(origin).slice(0, 12)}`;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function labelFromId(value: string): string {
  return value.split('/').pop()?.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase()) ?? value;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
