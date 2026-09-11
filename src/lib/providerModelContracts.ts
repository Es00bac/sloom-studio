import type { SelectOption } from '../types/flow';

export const MODEL_LIFECYCLES = [
  'stable',
  'preview',
  'deprecated',
  'shutdown',
  'unverified',
] as const;

export type ModelLifecycle = (typeof MODEL_LIFECYCLES)[number];

export const MODEL_AVAILABILITIES = [
  'documented',
  'live',
  'rollout-dependent',
  'account-dependent',
  'curated-only',
  'legacy-saved',
  'unavailable',
] as const;

export type ModelAvailability = (typeof MODEL_AVAILABILITIES)[number];

export type ApiFamily =
  | 'openai-responses'
  | 'openai-chat-completions'
  | 'openai-images'
  | 'google-gemini'
  | 'google-interactions'
  | 'google-vertex'
  | 'huggingface-inference'
  | 'elevenlabs'
  | 'bfl'
  | 'stability'
  | 'atlas'
  | 'byteplus-modelark'
  | 'local-open'
  | 'android-accelerator';

export type ModelModality = 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'json';

export type ModelOperation =
  | 'text-generation'
  | 'text-to-image'
  | 'image-edit'
  | 'image-variation'
  | 'image-upscale'
  | 'mask-inpaint'
  | 'outpaint'
  | 'erase'
  | 'search-replace'
  | 'search-recolor'
  | 'remove-background'
  | 'replace-background-relight'
  | 'local-open-edit'
  | 'text-to-video'
  | 'image-to-video'
  | 'video-extension'
  | 'frame-interpolation'
  | 'reference-to-video'
  | 'video-edit'
  | 'text-to-speech'
  | 'speech-to-speech'
  | 'text-to-sound-effect'
  | 'text-to-music';

export type ModelRequestBuilderFamily = ApiFamily | 'elevenlabs-sound-generation';

export type ModelParameterType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object';

export interface ModelParameterCondition {
  operations?: readonly ModelOperation[];
  parameter?: string;
  equals?: unknown;
  oneOf?: readonly unknown[];
}

export interface ModelParameterContract {
  /** Stable Flow UI control identifier. */
  id: string;
  /** Exact field name sent to the provider API. */
  apiName: string;
  label: string;
  description?: string;
  type: ModelParameterType;
  required?: boolean;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  minItems?: number;
  maxItems?: number;
  options?: readonly SelectOption[];
  conditions?: ModelParameterCondition;
  unsupportedReason?: string;
}

export interface ModelOfficialEvidence {
  title: string;
  url: string;
  /** ISO date on which the contract was checked against this source. */
  verifiedAt: string;
}

export interface ModelAuthContract {
  type: 'api-key' | 'oauth' | 'vertex-adc' | 'api-key-or-vertex-adc' | 'bearer' | 'none';
  credentialKey?: string;
  notes?: string;
}

export interface ModelFlowExample {
  summary: string;
  inputs: readonly string[];
  outputs: readonly string[];
}

export interface ProviderModelContract {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  apiFamily: ApiFamily;
  endpoint: string;
  auth: ModelAuthContract;
  inputModalities: readonly ModelModality[];
  outputModalities: readonly ModelModality[];
  operations: readonly ModelOperation[];
  parameters: readonly ModelParameterContract[];
  lifecycle: ModelLifecycle;
  availability: ModelAvailability;
  evidence: readonly ModelOfficialEvidence[];
  limitations: readonly string[];
  recommendedUse: string;
  flowExample: ModelFlowExample;
  requestBuilder: ModelRequestBuilderFamily;
  migrationModelId?: string;
  shutdownAt?: string;
}

export interface ModelCatalogEntry extends SelectOption {
  providerId: string;
  modelId: string;
  lifecycle: ModelLifecycle;
  availability: ModelAvailability;
  source: 'curated' | 'live' | 'curated-and-live' | 'saved';
  verified: boolean;
  warning?: string;
}

export interface RequestedModelControl {
  id: string;
  label: string;
  description?: string;
}

export interface ModelUiControl extends RequestedModelControl {
  parameter?: ModelParameterContract;
  enabled: boolean;
  disabledReason?: string;
}

export type ModelRequestIssueCode =
  | 'unsupported-operation'
  | 'unsupported-parameter'
  | 'inactive-parameter'
  | 'required'
  | 'invalid-type'
  | 'invalid-enum'
  | 'out-of-range';

export interface ModelRequestIssue {
  code: ModelRequestIssueCode;
  field: string;
  message: string;
}

export interface ModelRequestValidationResult {
  valid: boolean;
  issues: ModelRequestIssue[];
}

export function defineProviderModelContracts<T extends readonly ProviderModelContract[]>(
  contracts: T,
): T {
  const keys = new Set<string>();

  for (const contract of contracts) {
    const key = modelContractKey(contract.providerId, contract.modelId);
    if (keys.has(key)) {
      throw new Error(`Duplicate provider model contract: ${key}`);
    }
    keys.add(key);
    assertContract(contract);
  }

  return contracts;
}

export function getProviderModelContract(
  contracts: readonly ProviderModelContract[],
  providerId: string,
  modelId: string,
): ProviderModelContract | undefined {
  return contracts.find(
    (contract) => contract.providerId === providerId && contract.modelId === modelId,
  );
}

export function getModelUiControls(
  contract: ProviderModelContract,
  operation: ModelOperation,
  requestedControls: readonly RequestedModelControl[],
  currentValues: Readonly<Record<string, unknown>> = {},
): ModelUiControl[] {
  return requestedControls.map((requested) => {
    const parameter = contract.parameters.find((candidate) => candidate.id === requested.id);
    if (!parameter) {
      return {
        ...requested,
        enabled: false,
        disabledReason: `${contract.displayName} does not expose ${requested.label}.`,
      };
    }

    const inactiveReason = getInactiveReason(parameter, operation, currentValues);
    return {
      ...requested,
      description: requested.description ?? parameter.description,
      parameter,
      enabled: !inactiveReason,
      disabledReason: inactiveReason,
    };
  });
}

export function validateModelRequest(
  contract: ProviderModelContract,
  operation: ModelOperation,
  request: Readonly<Record<string, unknown>>,
): ModelRequestValidationResult {
  if (!contract.operations.includes(operation)) {
    return {
      valid: false,
      issues: [
        {
          code: 'unsupported-operation',
          field: 'operation',
          message: `${contract.displayName} does not support ${operationLabel(operation)}.`,
        },
      ],
    };
  }

  const issues: ModelRequestIssue[] = [];
  const parametersByApiName = new Map(
    contract.parameters.map((parameter) => [parameter.apiName, parameter] as const),
  );

  for (const parameter of contract.parameters) {
    const inactiveReason = getInactiveReason(parameter, operation, request);
    const value = request[parameter.apiName];
    if (!inactiveReason && parameter.required && (value === undefined || value === null || value === '')) {
      issues.push({
        code: 'required',
        field: parameter.apiName,
        message: `${parameter.label} is required.`,
      });
    }
  }

  for (const [field, value] of Object.entries(request)) {
    const parameter = parametersByApiName.get(field);
    if (!parameter) {
      issues.push({
        code: 'unsupported-parameter',
        field,
        message: `${contract.displayName} does not expose the API parameter ${field}.`,
      });
      continue;
    }

    const inactiveReason = getInactiveReason(parameter, operation, request);
    if (inactiveReason) {
      issues.push({
        code: 'inactive-parameter',
        field,
        message: inactiveReason,
      });
      continue;
    }

    if (value === undefined || value === null) continue;
    validateParameterValue(parameter, value, issues);
  }

  return { valid: issues.length === 0, issues };
}

export interface UnverifiedModelContractInput {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  apiFamily: ApiFamily;
  endpoint: string;
  auth: ModelAuthContract;
  inputModalities: readonly ModelModality[];
  outputModalities: readonly ModelModality[];
  operation: ModelOperation;
  requestBuilder: ModelRequestBuilderFamily;
}

export function createUnverifiedModelContract(
  input: UnverifiedModelContractInput,
): ProviderModelContract {
  const { operation, ...contractIdentity } = input;
  return {
    ...contractIdentity,
    operations: [operation],
    parameters: [
      {
        id: 'prompt',
        apiName: safePromptApiName(input.apiFamily),
        label: 'Prompt',
        type: 'string',
        required: true,
      },
    ],
    lifecycle: 'unverified',
    availability: 'live',
    evidence: [],
    limitations: [
      'This live model has no curated capability contract. Only safe, endpoint-level controls are enabled.',
    ],
    recommendedUse: 'Use only after confirming the model and endpoint behavior for your account.',
    flowExample: {
      summary: `Prompt -> ${input.displayName}`,
      inputs: ['Connect a Text node to the prompt input.'],
      outputs: [`Connect the ${input.outputModalities.join('/')} output to a compatible node.`],
    },
  };
}

function assertContract(contract: ProviderModelContract): void {
  if (!contract.providerId || !contract.modelId || !contract.displayName) {
    throw new Error('Provider model contracts require provider, model, and display identifiers.');
  }
  if (!MODEL_LIFECYCLES.includes(contract.lifecycle)) {
    throw new Error(`Invalid model lifecycle for ${contract.modelId}: ${contract.lifecycle}`);
  }
  if (!MODEL_AVAILABILITIES.includes(contract.availability)) {
    throw new Error(`Invalid model availability for ${contract.modelId}: ${contract.availability}`);
  }
  if (contract.operations.length === 0 || contract.outputModalities.length === 0) {
    throw new Error(`${contract.modelId} must declare operations and output modalities.`);
  }
  if (contract.lifecycle !== 'unverified' && contract.evidence.length === 0) {
    throw new Error(`Verified contract ${contract.modelId} requires official evidence.`);
  }
  for (const evidence of contract.evidence) {
    if (!evidence.title || !isHttpUrl(evidence.url) || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.verifiedAt)) {
      throw new Error(`Invalid official evidence for ${contract.modelId}.`);
    }
  }

  const ids = new Set<string>();
  const apiNames = new Set<string>();
  for (const parameter of contract.parameters) {
    if (!parameter.id || !parameter.apiName || !parameter.label) {
      throw new Error(`${contract.modelId} has a parameter without an id, API name, or label.`);
    }
    if (ids.has(parameter.id) || apiNames.has(parameter.apiName)) {
      throw new Error(`${contract.modelId} has duplicate parameter identifiers.`);
    }
    ids.add(parameter.id);
    apiNames.add(parameter.apiName);
    assertParameter(parameter, contract.modelId);
  }
}

function assertParameter(parameter: ModelParameterContract, modelId: string): void {
  if (
    parameter.min !== undefined &&
    parameter.max !== undefined &&
    parameter.min > parameter.max
  ) {
    throw new Error(`${modelId}.${parameter.id} has an invalid numeric range.`);
  }
  if (
    parameter.minItems !== undefined &&
    parameter.maxItems !== undefined &&
    parameter.minItems > parameter.maxItems
  ) {
    throw new Error(`${modelId}.${parameter.id} has an invalid array range.`);
  }
  if (parameter.type === 'enum' && (!parameter.options || parameter.options.length === 0)) {
    throw new Error(`${modelId}.${parameter.id} must declare enum options.`);
  }
  if (parameter.type !== 'enum' && parameter.options !== undefined) {
    throw new Error(`${modelId}.${parameter.id} has enum options but is not an enum.`);
  }
  if (
    !['number', 'integer'].includes(parameter.type) &&
    (parameter.min !== undefined || parameter.max !== undefined || parameter.step !== undefined)
  ) {
    throw new Error(`${modelId}.${parameter.id} has numeric constraints on a non-number.`);
  }
  if (
    parameter.type !== 'array' &&
    (parameter.minItems !== undefined || parameter.maxItems !== undefined)
  ) {
    throw new Error(`${modelId}.${parameter.id} has array constraints on a non-array.`);
  }
}

function validateParameterValue(
  parameter: ModelParameterContract,
  value: unknown,
  issues: ModelRequestIssue[],
): void {
  if (!matchesType(parameter.type, value)) {
    issues.push({
      code: 'invalid-type',
      field: parameter.apiName,
      message: `${parameter.label} must be ${typeLabel(parameter.type)}.`,
    });
    return;
  }

  if (parameter.type === 'enum') {
    const allowed = parameter.options?.map((option) => option.value) ?? [];
    if (!allowed.includes(String(value))) {
      issues.push({
        code: 'invalid-enum',
        field: parameter.apiName,
        message: `${parameter.label} must be one of: ${allowed.join(', ')}.`,
      });
    }
  }

  if (typeof value === 'number') {
    if (parameter.min !== undefined && value < parameter.min) {
      pushRangeIssue(parameter, issues);
    } else if (parameter.max !== undefined && value > parameter.max) {
      pushRangeIssue(parameter, issues);
    }
  }

  if (Array.isArray(value)) {
    if (parameter.minItems !== undefined && value.length < parameter.minItems) {
      pushRangeIssue(parameter, issues);
    } else if (parameter.maxItems !== undefined && value.length > parameter.maxItems) {
      pushRangeIssue(parameter, issues);
    }
  }
}

function pushRangeIssue(
  parameter: ModelParameterContract,
  issues: ModelRequestIssue[],
): void {
  const min = parameter.type === 'array' ? parameter.minItems : parameter.min;
  const max = parameter.type === 'array' ? parameter.maxItems : parameter.max;
  issues.push({
    code: 'out-of-range',
    field: parameter.apiName,
    message: `${parameter.label} must be within ${String(min ?? 'the minimum')}–${String(max ?? 'the maximum')}.`,
  });
}

function matchesType(type: ModelParameterType, value: unknown): boolean {
  switch (type) {
    case 'string':
    case 'enum':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

function getInactiveReason(
  parameter: ModelParameterContract,
  operation: ModelOperation,
  values: Readonly<Record<string, unknown>>,
): string | undefined {
  if (parameter.unsupportedReason) return parameter.unsupportedReason;
  const condition = parameter.conditions;
  if (!condition) return undefined;
  if (condition.operations && !condition.operations.includes(operation)) {
    return `${parameter.label} is only available for ${condition.operations.map(operationLabel).join(' or ')}.`;
  }
  if (condition.parameter) {
    const actual = values[condition.parameter];
    if (condition.oneOf && !condition.oneOf.includes(actual)) {
      return `${parameter.label} is unavailable for the current ${condition.parameter} value.`;
    }
    if ('equals' in condition && actual !== condition.equals) {
      return `${parameter.label} requires ${condition.parameter} to be ${String(condition.equals)}.`;
    }
  }
  return undefined;
}

function safePromptApiName(apiFamily: ApiFamily): string {
  if (apiFamily === 'openai-responses') return 'input';
  if (apiFamily === 'google-gemini' || apiFamily === 'google-vertex') return 'contents';
  if (apiFamily === 'google-interactions') return 'input';
  if (apiFamily === 'huggingface-inference') return 'inputs';
  return 'prompt';
}

function operationLabel(operation: ModelOperation): string {
  return operation.replaceAll('-', ' ');
}

function typeLabel(type: ModelParameterType): string {
  if (type === 'integer') return 'an integer';
  if (type === 'array') return 'an array';
  if (type === 'object') return 'an object';
  return `a ${type}`;
}

function modelContractKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
