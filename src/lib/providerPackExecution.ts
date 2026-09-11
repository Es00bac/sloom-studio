import type { Edge } from '@xyflow/react';
import type { AppNode, NodeOutputArtifact, ResultType } from '../types/flow';
import {
  type FlowModelCardV1,
  type ModelCardOperationV1,
  type ProviderPackV1,
  type TransportProfileV1,
} from './providerPackContracts';
import { providerPackRegistry } from './providerPackRegistry';
import { isExactApprovedUrl } from './providerPackValidation';
import { getSignalLoomNativeBridge } from './nativeApp';

const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_SSE_BYTES = 10 * 1024 * 1024;

export interface ProviderPackExecutionResult {
  result: string;
  resultType: ResultType;
  statusMessage: string;
  blob?: Blob;
  mimeType?: string;
  extension?: string;
  outputMetadata?: Record<string, unknown>;
  additionalResults?: Array<{ result: string; mimeType?: string }>;
  namedOutputs?: Record<string, NodeOutputArtifact>;
}

export interface ProviderPackRequestPreview {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  text: string;
}

export function modelCardInputHandle(fieldId: string, index?: number): string {
  return index === undefined ? `model-card:${fieldId}` : `model-card:${fieldId}:${index}`;
}

export function modelCardOutputHandle(outputId: string): string {
  return `model-card-output:${outputId}`;
}

export function collectModelCardConnectedValues(input: {
  node: AppNode;
  nodes: readonly AppNode[];
  edges: readonly Edge[];
  card: FlowModelCardV1;
  operationId: string;
}): Record<string, unknown> {
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const values: Record<string, unknown> = {};
  const operation = input.card.operations.find((candidate) => candidate.id === input.operationId);
  if (!operation) return values;
  for (const fieldId of operation.inputPortFieldIds) {
    const field = input.card.fields.find((candidate) => candidate.id === fieldId);
    if (!field) continue;
    const matching = input.edges
      .filter((edge) =>
        edge.target === input.node.id
        && (
          edge.targetHandle === modelCardInputHandle(field.id)
          || edge.targetHandle?.startsWith(`${modelCardInputHandle(field.id)}:`)
        )
      )
      .sort((left, right) => handleIndex(left.targetHandle) - handleIndex(right.targetHandle));
    const connected = matching.flatMap((edge) => {
      const result = nodesById.get(edge.source)?.data.result;
      return typeof result === 'string' || typeof result === 'boolean' ? [result] : [];
    });
    if (field.cardinality === 'many') {
      if (connected.length) values[field.id] = connected;
    } else if (connected.length) {
      values[field.id] = connected[0];
    }
  }
  return values;
}

export function resolveBuiltInEngine(
  pack: ProviderPackV1,
  card: FlowModelCardV1,
  operationId: string,
): string | undefined {
  const operation = card.operations.find((candidate) => candidate.id === operationId);
  const transport = pack.transports.find((candidate) => candidate.id === operation?.transportProfileId);
  return transport?.kind === 'built-in' ? transport.builtInEngineId : undefined;
}

export async function previewProviderPackRequest(input: {
  pack: ProviderPackV1;
  card: FlowModelCardV1;
  operationId: string;
  values: Record<string, unknown>;
}): Promise<ProviderPackRequestPreview> {
  const { operation, transport } = resolveRoute(input.pack, input.card, input.operationId);
  if (transport.kind === 'built-in') {
    return {
      method: 'BUILT-IN',
      url: `${transport.approvedOrigin} · ${transport.builtInEngineId}`,
      headers: {},
      body: input.values,
      text: `Registered Sloom engine: ${transport.builtInEngineId}\nOrigin: ${transport.approvedOrigin}\nCredentials: [local slot, never included]\n\n${JSON.stringify(input.values, null, 2)}`,
    };
  }
  const request = await buildRequest(input.pack, input.card, operation, transport, input.values, false);
  const redactedHeaders = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [
    key,
    /authorization|api[-_]?key|token|secret|cookie/i.test(key) ? '[redacted]' : value,
  ]));
  const body = request.body instanceof FormData
    ? Object.fromEntries([...request.body.entries()].map(([key, value]) => [key, value instanceof Blob ? `[${value.type || 'binary'} ${value.size} bytes]` : value]))
    : request.body;
  return {
    method: request.method,
    url: request.url.toString(),
    headers: redactedHeaders,
    body,
    text: [
      `${request.method} ${request.url.toString()}`,
      ...Object.entries(redactedHeaders).map(([key, value]) => `${key}: ${value}`),
      '',
      typeof body === 'string' ? body : JSON.stringify(body, null, 2),
    ].join('\n'),
  };
}

export async function executeProviderPackCard(input: {
  pack: ProviderPackV1;
  card: FlowModelCardV1;
  operationId: string;
  values: Record<string, unknown>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onStatus?: (message: string) => void;
}): Promise<ProviderPackExecutionResult> {
  if (input.card.status === 'draft') {
    throw new Error('This model card is a draft. Fix its blocking issues before running it.');
  }
  providerPackRegistry.assertExecutionAllowed(
    input.pack,
    input.card,
    input.operationId,
    input.values,
  );
  const { operation, transport } = resolveRoute(input.pack, input.card, input.operationId);
  if (transport.kind === 'built-in') {
    throw new Error(`Registered engine ${transport.builtInEngineId} must execute through Sloom's built-in compatibility adapter.`);
  }
  assertRequiredValues(input.card, operation, input.values);
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = await buildRequest(input.pack, input.card, operation, transport, input.values, true);
  input.onStatus?.(`Sending ${operation.label} request…`);

  if (transport.kind === 'submit-poll') {
    return executeSubmitPoll({ ...input, operation, transport, request, fetchImpl });
  }

  const response = await restrictedFetch(fetchImpl, request, input.signal);
  if (!response.ok) throw await responseError(response);
  if (transport.kind === 'sse') {
    input.onStatus?.('Streaming provider response…');
    return materializeSse(response, input.card, operation, transport, input.signal);
  }
  input.onStatus?.('Reading provider result…');
  return materializeResponse(response, input.card, operation, transport, input.signal);
}

export async function fetchRemoteOptions(input: {
  pack: ProviderPackV1;
  catalogId: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<Array<{ value: string; label: string }>> {
  const catalog = input.pack.optionCatalogs.find((candidate) => candidate.id === input.catalogId);
  if (!catalog) throw new Error('Option catalog was not found.');
  if (catalog.entries) return catalog.entries.filter((entry) => !entry.disabled);
  if (!catalog.remote) return [];
  const transport = input.pack.transports.find((candidate) => candidate.id === catalog.remote?.transportProfileId);
  if (!transport) throw new Error('Remote option transport was not found.');
  const url = buildExactUrl(transport.approvedOrigin, catalog.remote.endpointPath);
  const headers = await credentialHeaders(input.pack, transport);
  const response = await restrictedFetch(input.fetchImpl ?? fetch, {
    url,
    method: 'GET',
    headers,
  }, input.signal);
  if (!response.ok) throw await responseError(response);
  const json = JSON.parse(await readBoundedText(response, MAX_SSE_BYTES)) as unknown;
  const items = jsonPointer(json, catalog.remote.itemsPointer);
  if (!Array.isArray(items)) return [];
  return items.slice(0, 10_000).flatMap((item) => {
    const value = jsonPointer(item, catalog.remote?.valuePointer ?? '');
    const label = jsonPointer(item, catalog.remote?.labelPointer ?? '');
    return typeof value === 'string' && typeof label === 'string' ? [{ value, label }] : [];
  });
}

async function executeSubmitPoll(input: {
  pack: ProviderPackV1;
  card: FlowModelCardV1;
  operationId: string;
  values: Record<string, unknown>;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  operation: ModelCardOperationV1;
  transport: TransportProfileV1;
  request: BuiltRequest;
  fetchImpl: typeof fetch;
}): Promise<ProviderPackExecutionResult> {
  const poll = input.transport.poll;
  if (!poll) throw new Error('Submit/poll transport is missing its polling contract.');
  const submit = await restrictedFetch(input.fetchImpl, input.request, input.signal);
  if (!submit.ok) throw await responseError(submit);
  const submitted = JSON.parse(await readBoundedText(submit, MAX_SSE_BYTES)) as unknown;
  const jobId = jsonPointer(submitted, poll.idPointer);
  if (typeof jobId !== 'string' && typeof jobId !== 'number') {
    throw new Error('Provider submission did not return the configured job ID.');
  }
  const startedAt = Date.now();
  const headers = await credentialHeaders(input.pack, input.transport);
  const cancel = async () => {
    if (!poll.cancelPath) return;
    const cancelUrl = buildExactUrl(input.transport.approvedOrigin, replaceJobId(poll.cancelPath, jobId));
    await restrictedFetch(input.fetchImpl, { url: cancelUrl, method: 'POST', headers }, undefined).catch(() => undefined);
  };
  const onAbort = () => void cancel();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (Date.now() - startedAt <= poll.timeoutMs) {
      if (input.signal?.aborted) throw new DOMException('The provider job was cancelled.', 'AbortError');
      const statusPath = replaceJobId(poll.statusPath, jobId);
      input.onStatus?.(`Waiting for provider job ${String(jobId)}…`);
      const response = await restrictedFetch(input.fetchImpl, {
        url: buildExactUrl(input.transport.approvedOrigin, statusPath),
        method: 'GET',
        headers,
      }, input.signal);
      if (!response.ok) throw await responseError(response);
      const status = JSON.parse(await readBoundedText(response, MAX_SSE_BYTES)) as unknown;
      const state = String(jsonPointer(status, poll.statePointer) ?? '');
      if (poll.failureValues.includes(state)) {
        const message = poll.errorPointer ? jsonPointer(status, poll.errorPointer) : undefined;
        throw new Error(typeof message === 'string' ? message : `Provider job failed with state ${state}.`);
      }
      if (poll.successValues.includes(state)) {
        const resultUrl = buildExactUrl(input.transport.approvedOrigin, replaceJobId(poll.resultPath, jobId));
        const result = await restrictedFetch(input.fetchImpl, { url: resultUrl, method: 'GET', headers }, input.signal);
        if (!result.ok) throw await responseError(result);
        return materializeResponse(result, input.card, input.operation, input.transport, input.signal);
      }
      await abortableDelay(poll.intervalMs, input.signal);
    }
    throw new Error(`Provider job exceeded its ${Math.round(poll.timeoutMs / 1_000)} second timeout.`);
  } finally {
    input.signal?.removeEventListener('abort', onAbort);
  }
}

interface BuiltRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
}

async function buildRequest(
  pack: ProviderPackV1,
  _card: FlowModelCardV1,
  operation: ModelCardOperationV1,
  transport: TransportProfileV1,
  values: Record<string, unknown>,
  includeCredential: boolean,
): Promise<BuiltRequest> {
  const endpointPath = operation.endpointPath ?? transport.endpointPath;
  if (!endpointPath) throw new Error('Operation has no endpoint path.');
  const url = buildExactUrl(transport.approvedOrigin, endpointPath);
  const method = transport.method ?? 'POST';
  const headers: Record<string, string> = {
    Accept: transport.kind === 'sse' ? 'text/event-stream' : '*/*',
    ...transport.staticHeaders,
    ...(includeCredential ? await credentialHeaders(pack, transport) : {}),
  };
  const bindings = operation.requestBindings ?? transport.requestBindings ?? [];
  const bodyKind = transport.bodyKind ?? 'json';
  if (method === 'GET') {
    for (const binding of bindings) {
      const value = values[binding.fieldId];
      if (isEmpty(value) && binding.omitWhenEmpty) continue;
      if (value !== undefined) url.searchParams.set(binding.requestPath, scalarString(value));
    }
    return { url, method, headers };
  }
  if (bodyKind === 'none') return { url, method, headers };
  if (bodyKind === 'multipart') {
    const form = new FormData();
    for (const binding of bindings) {
      const value = values[binding.fieldId];
      if (isEmpty(value) && binding.omitWhenEmpty) continue;
      await appendFormValue(form, binding.requestPath, value, binding.encoding);
    }
    return { url, method, headers, body: form };
  }
  if (bodyKind === 'raw') {
    const first = bindings.find((binding) => values[binding.fieldId] !== undefined);
    const raw = first ? await encodeFieldValue(values[first.fieldId], first.encoding) : '';
    return {
      url,
      method,
      headers: { ...headers, 'Content-Type': raw instanceof Blob ? raw.type || 'application/octet-stream' : 'text/plain' },
      body: raw instanceof Blob ? raw : scalarString(raw),
    };
  }
  const body: Record<string, unknown> = {};
  for (const binding of bindings) {
    const value = values[binding.fieldId];
    if (isEmpty(value) && binding.omitWhenEmpty) continue;
    if (value === undefined) continue;
    setRequestPath(body, binding.requestPath, await encodeFieldValue(value, binding.encoding));
  }
  headers['Content-Type'] = 'application/json';
  return { url, method, headers, body: JSON.stringify(body) };
}

async function credentialHeaders(
  pack: ProviderPackV1,
  transport: TransportProfileV1,
): Promise<Record<string, string>> {
  if (!transport.credentialSlotId) return {};
  const slot = pack.credentialSlots.find((candidate) => candidate.id === transport.credentialSlotId);
  if (!slot || slot.approvedOrigin !== transport.approvedOrigin) {
    throw new Error('Credential slot origin does not match the transport origin.');
  }
  const credential = await providerPackRegistry.getCredential(pack.packId, slot.id, slot.approvedOrigin);
  if (!credential) {
    if (slot.required) throw new Error(`Configure the local credential slot "${slot.label}" before running.`);
    return {};
  }
  if (slot.authType === 'bearer') return { Authorization: `Bearer ${credential}` };
  if (slot.authType === 'basic') return { Authorization: `Basic ${credential}` };
  if (slot.authType === 'api-key-header') return { [slot.headerName ?? 'x-api-key']: credential };
  if (slot.authType === 'none') return {};
  throw new Error(`${slot.authType} requires a registered built-in authentication engine.`);
}

async function restrictedFetch(
  fetchImpl: typeof fetch,
  request: BuiltRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const bridge = getSignalLoomNativeBridge();
  if (fetchImpl === globalThis.fetch && bridge?.providerPackRequest) {
    return nativeRestrictedFetch(bridge, request, signal);
  }
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error('Provider redirect was blocked so credentials cannot cross origins.');
  }
  return response;
}

async function nativeRestrictedFetch(
  bridge: NonNullable<ReturnType<typeof getSignalLoomNativeBridge>>,
  request: BuiltRequest,
  signal?: AbortSignal,
): Promise<Response> {
  if (!bridge.providerPackRequest) throw new Error('The native provider broker is unavailable.');
  if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
  const cancellationId = globalThis.crypto?.randomUUID?.() ?? `provider-pack-${Date.now()}-${Math.random()}`;
  const onAbort = () => void bridge.cancelProviderPackRequest?.(cancellationId);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const result = await bridge.providerPackRequest({
      url: request.url.toString(),
      approvedOrigin: request.url.origin,
      method: request.method,
      headers: request.headers,
      body: await serializeNativeRequestBody(request.body),
      cancellationId,
    });
    if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    if (result.error || result.status === undefined || typeof result.base64 !== 'string') {
      throw new Error(result.error ?? 'The native provider broker returned an invalid response.');
    }
    const responseBody = [204, 205, 304].includes(result.status)
      ? null
      : base64ToBlob(result.base64, result.headers?.['content-type'] ?? 'application/octet-stream');
    return new Response(responseBody, {
      status: result.status,
      headers: result.headers,
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

async function serializeNativeRequestBody(
  body: BodyInit | undefined,
): Promise<{
  kind: 'text' | 'binary' | 'multipart';
  text?: string;
  base64?: string;
  mimeType?: string;
  parts?: Array<{ name: string; value?: string; base64?: string; mimeType?: string; fileName?: string }>;
} | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return { kind: 'text', text: body };
  if (body instanceof FormData) {
    const parts = await Promise.all([...body.entries()].map(async ([name, value]) =>
      value instanceof Blob
        ? {
            name,
            base64: await blobToBase64(value),
            mimeType: value.type,
            fileName: typeof File !== 'undefined' && value instanceof File ? value.name : 'upload.bin',
          }
        : { name, value }
    ));
    return { kind: 'multipart', parts };
  }
  if (body instanceof Blob) {
    return {
      kind: 'binary',
      base64: await blobToBase64(body),
      mimeType: body.type,
    };
  }
  if (body instanceof URLSearchParams) return { kind: 'text', text: body.toString() };
  if (body instanceof ArrayBuffer) {
    return { kind: 'binary', base64: bytesToBase64(new Uint8Array(body)) };
  }
  if (ArrayBuffer.isView(body)) {
    return {
      kind: 'binary',
      base64: bytesToBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)),
    };
  }
  throw new Error('The native provider broker cannot serialize this request body.');
}

async function materializeResponse(
  response: Response,
  card: FlowModelCardV1,
  operation: ModelCardOperationV1,
  transport: TransportProfileV1,
  signal?: AbortSignal,
): Promise<ProviderPackExecutionResult> {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  const extraction = operation.outputExtractions ?? transport.outputExtractions ?? [];
  const primary = card.outputs.find((output) => output.primary && operation.outputIds.includes(output.id))
    ?? card.outputs.find((output) => operation.outputIds.includes(output.id));
  if (!primary) throw new Error('Operation has no primary output.');
  if (
    (contentType !== '' && !contentType.includes('json'))
    || extraction.find((item) => item.outputId === primary.id)?.kind === 'binary'
  ) {
    const blob = await readBoundedBlob(response, signal);
    const materialized = {
      result: URL.createObjectURL(blob),
      resultType: primary.resultType,
      blob,
      mimeType: blob.type || contentType,
      extension: extensionForMime(blob.type || contentType),
      statusMessage: `${card.displayName} returned ${primary.label}.`,
    };
    return {
      ...materialized,
      namedOutputs: {
        [modelCardOutputHandle(primary.id)]: {
          result: materialized.result,
          resultType: materialized.resultType,
          blob: materialized.blob,
          mimeType: materialized.mimeType,
          extension: materialized.extension,
        },
      },
    };
  }
  const json = JSON.parse(await readBoundedText(response, MAX_RESPONSE_BYTES, signal)) as unknown;
  const namedOutputs: Record<string, NodeOutputArtifact> = {};
  for (const outputId of operation.outputIds) {
    const output = card.outputs.find((candidate) => candidate.id === outputId);
    const rule = extraction.find((item) => item.outputId === outputId);
    if (!output || !rule || rule.kind !== 'json-pointer' || !rule.pointer) continue;
    const value = jsonPointer(json, rule.pointer);
    const values = rule.list || output.cardinality === 'many'
      ? Array.isArray(value) ? value : [value]
      : [value];
    const materialized = await Promise.all(values.filter((item) => item !== undefined && item !== null).map((item) =>
      materializeExtractedValue(item, output.resultType, rule.defaultMimeType, signal)
    ));
    if (!materialized.length) continue;
    namedOutputs[modelCardOutputHandle(output.id)] = {
      ...materialized[0],
      additionalResults: materialized.slice(1).map((item) => ({ result: item.result, mimeType: item.mimeType })),
    };
  }
  const primaryOutput = namedOutputs[modelCardOutputHandle(primary.id)];
  if (!primaryOutput) throw new Error(`Provider response did not contain the configured ${primary.label} output.`);
  return {
    result: typeof primaryOutput.result === 'string' ? primaryOutput.result : String(primaryOutput.result),
    resultType: primaryOutput.resultType,
    blob: primaryOutput.blob,
    mimeType: primaryOutput.mimeType,
    extension: primaryOutput.extension,
    additionalResults: primaryOutput.additionalResults,
    statusMessage: `${card.displayName} returned ${primary.label}.`,
    outputMetadata: { providerResponse: redactResponseMetadata(json), outputId: primary.id },
    namedOutputs,
  };
}

async function materializeSse(
  response: Response,
  card: FlowModelCardV1,
  operation: ModelCardOperationV1,
  transport: TransportProfileV1,
  signal?: AbortSignal,
): Promise<ProviderPackExecutionResult> {
  const text = await readBoundedText(response, MAX_SSE_BYTES, signal);
  const rule = (operation.outputExtractions ?? transport.outputExtractions ?? [])
    .find((item) => item.kind === 'sse-text' || item.outputId === operation.outputIds[0]);
  let output = '';
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as unknown;
      const fragment = rule?.pointer ? jsonPointer(parsed, rule.pointer) : parsed;
      if (typeof fragment === 'string') output += fragment;
    } catch {
      output += payload;
    }
  }
  if (!output) throw new Error('Streaming response did not contain text at the configured path.');
  const materialized = {
    result: output,
    resultType: 'text' as const,
    statusMessage: `${card.displayName} finished streaming.`,
  };
  const outputId = operation.outputIds[0];
  return {
    ...materialized,
    ...(outputId ? {
      namedOutputs: {
        [modelCardOutputHandle(outputId)]: {
          result: materialized.result,
          resultType: materialized.resultType,
        },
      },
    } : {}),
  };
}

async function materializeExtractedValue(
  value: unknown,
  resultType: ResultType,
  defaultMimeType?: string,
  signal?: AbortSignal,
): Promise<Omit<ProviderPackExecutionResult, 'statusMessage'>> {
  if (resultType === 'text') return { result: typeof value === 'string' ? value : JSON.stringify(value), resultType };
  if (resultType === 'json') return { result: JSON.stringify(value), resultType };
  if (typeof value !== 'string') throw new Error('Media output must be a URL, data URI, or base64 string.');
  if (value.startsWith('data:')) {
    const blob = dataUriToBlob(value);
    return {
      result: URL.createObjectURL(blob),
      resultType,
      blob,
      mimeType: blob.type,
      extension: extensionForMime(blob.type),
    };
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, { redirect: 'error', signal });
    if (!response.ok) throw new Error(`Media download failed with status ${response.status}.`);
    const blob = await readBoundedBlob(response, signal);
    return {
      result: URL.createObjectURL(blob),
      resultType,
      blob,
      mimeType: blob.type || defaultMimeType,
      extension: extensionForMime(blob.type || defaultMimeType),
    };
  }
  const blob = base64ToBlob(value, defaultMimeType ?? mimeForResultType(resultType));
  return {
    result: URL.createObjectURL(blob),
    resultType,
    blob,
    mimeType: blob.type,
    extension: extensionForMime(blob.type),
  };
}

function resolveRoute(pack: ProviderPackV1, card: FlowModelCardV1, operationId: string) {
  const operation = card.operations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`Operation ${operationId} is not defined for ${card.displayName}.`);
  const transport = pack.transports.find((candidate) => candidate.id === operation.transportProfileId);
  if (!transport) throw new Error(`${operation.label} has no transport route.`);
  return { operation, transport };
}

function assertRequiredValues(
  card: FlowModelCardV1,
  operation: ModelCardOperationV1,
  values: Record<string, unknown>,
): void {
  for (const fieldId of operation.requiredFieldIds) {
    const field = card.fields.find((candidate) => candidate.id === fieldId);
    if (isEmpty(values[fieldId])) throw new Error(`${field?.label ?? fieldId} is required.`);
  }
}

function buildExactUrl(origin: string, path: string): URL {
  const url = new URL(path, `${new URL(origin).origin}/`);
  if (!isExactApprovedUrl(url, origin)) throw new Error('Request URL does not match the exact approved origin.');
  return url;
}

function setRequestPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.startsWith('/')
    ? path.slice(1).split('/').map(unescapePointer)
    : path.split('.').filter(Boolean);
  if (!parts.length || parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new Error(`Unsafe request path ${path}.`);
  }
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!isRecord(existing)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

async function encodeFieldValue(value: unknown, encoding = 'json'): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => encodeFieldValue(item, encoding)));
  if (typeof value !== 'string' || !['base64', 'data-uri', 'binary'].includes(encoding)) return value;
  const blob = await resolveMediaBlob(value);
  if (encoding === 'binary') return blob;
  const base64 = await blobToBase64(blob);
  return encoding === 'data-uri' ? `data:${blob.type || 'application/octet-stream'};base64,${base64}` : base64;
}

async function appendFormValue(
  form: FormData,
  key: string,
  value: unknown,
  encoding = 'multipart',
): Promise<void> {
  for (const item of Array.isArray(value) ? value : [value]) {
    if (typeof item === 'string' && ['multipart', 'binary', 'base64', 'data-uri'].includes(encoding)) {
      const blob = await resolveMediaBlob(item);
      form.append(key, blob, `upload.${extensionForMime(blob.type) ?? 'bin'}`);
    } else if (item !== undefined && item !== null) {
      form.append(key, typeof item === 'object' ? JSON.stringify(item) : String(item));
    }
  }
}

async function resolveMediaBlob(value: string): Promise<Blob> {
  if (value.startsWith('data:')) return dataUriToBlob(value);
  if (/^blob:|^https?:/i.test(value)) {
    const response = await fetch(value, { redirect: 'error' });
    if (!response.ok) throw new Error('Connected media could not be read.');
    return readBoundedBlob(response);
  }
  return base64ToBlob(value, 'application/octet-stream');
}

async function readBoundedText(response: Response, limit: number, signal?: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('Provider response exceeds its safety limit.');
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new Error('Provider response exceeds its safety limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('Provider response exceeds its safety limit.');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function readBoundedBlob(response: Response, signal?: AbortSignal): Promise<Blob> {
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const textOrBinary = new Uint8Array(await response.arrayBuffer());
  if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
  if (textOrBinary.byteLength > MAX_RESPONSE_BYTES) throw new Error('Provider media response exceeds 50 MiB.');
  return new Blob([textOrBinary], { type: contentType });
}

async function responseError(response: Response): Promise<Error> {
  const message = await response.text().catch(() => '');
  return new Error(`Provider request failed (${response.status})${message ? `: ${message.slice(0, 500)}` : ''}`);
}

function jsonPointer(value: unknown, pointer: string): unknown {
  if (!pointer || pointer === '/') return value;
  const parts = pointer.startsWith('/')
    ? pointer.slice(1).split('/').map(unescapePointer)
    : pointer.split('.').filter(Boolean);
  return parts.reduce<unknown>((current, part) => {
    if (Array.isArray(current)) {
      const index = Number(part);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    return isRecord(current) ? current[part] : undefined;
  }, value);
}

function unescapePointer(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function replaceJobId(path: string, jobId: string | number): string {
  return path.replaceAll('{id}', encodeURIComponent(String(jobId)));
}

function redactResponseMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 50).map(redactResponseMetadata);
  if (!isRecord(value)) return typeof value === 'string' && value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    /key|token|secret|password|authorization|cookie/i.test(key)
      ? []
      : [[key, redactResponseMetadata(item)]]
  ));
}

function dataUriToBlob(value: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value);
  if (!match) throw new Error('Invalid data URI.');
  const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1] || 'application/octet-stream' });
}

function base64ToBlob(value: string, mimeType: string): Blob {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function mimeForResultType(resultType: ResultType): string {
  if (resultType === 'image') return 'image/png';
  if (resultType === 'video') return 'video/mp4';
  if (resultType === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

function extensionForMime(mimeType = ''): string | undefined {
  const mime = mimeType.split(';')[0].toLowerCase();
  return {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'application/json': 'json',
  }[mime];
}

function scalarString(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function handleIndex(handle: string | null | undefined): number {
  const match = /:(\d+)$/.exec(handle ?? '');
  return match ? Number(match[1]) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request cancelled.', 'AbortError'));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new DOMException('Request cancelled.', 'AbortError'));
    }, { once: true });
  });
}
