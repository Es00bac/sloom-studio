import { AUDIO_MODEL_CONTRACTS } from './modelContracts/audioModelContracts';
import { IMAGE_MODEL_CONTRACTS } from './modelContracts/imageModelContractAdapter';
import { TEXT_MODEL_CONTRACTS } from './modelContracts/textModelContracts';
import { VIDEO_MODEL_CONTRACTS } from './modelContracts/videoModelContracts';
import {
  BUNDLED_CARD_HEIGHT_BUDGET,
  CARD_WIDTH_PRESETS,
  type CardControlKindV1,
  type CredentialAuthTypeV1,
  type CredentialSlotV1,
  type FieldValueTypeV1,
  type FlowModelCardV1,
  type ModelCardOperationV1,
  type ModelFieldSemanticRoleV1,
  type ModelFieldV1,
  type ModelModalityV1,
  type ModelOutputSemanticRoleV1,
  type ModelOutputV1,
  type ProviderPackV1,
  type TransportProfileV1,
} from './providerPackContracts';
import { generateAutomaticCardLayout } from './providerCardLayout';
import type {
  ModelOperation,
  ModelParameterContract,
  ProviderModelContract,
} from './providerModelContracts';
import { PROVIDER_PACK_RELEASE_METADATA } from './providerPackReleaseMetadata';

interface BundledProviderDefinition {
  id: string;
  name: string;
  origin: string;
  authType: CredentialAuthTypeV1;
  credentialLabel?: string;
  headerName?: string;
  allowPlainHttpPrivateNetwork?: boolean;
  documentationUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
}

const PROVIDERS: Record<string, BundledProviderDefinition> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini / Vertex AI',
    origin: 'https://generativelanguage.googleapis.com',
    authType: 'custom-built-in',
    credentialLabel: 'Gemini API key or Vertex ADC',
    documentationUrl: 'https://ai.google.dev/gemini-api/docs',
    privacyUrl: 'https://policies.google.com/privacy',
    termsUrl: 'https://ai.google.dev/gemini-api/terms',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    origin: 'https://api.openai.com',
    authType: 'bearer',
    credentialLabel: 'OpenAI API key',
    documentationUrl: 'https://platform.openai.com/docs',
    privacyUrl: 'https://openai.com/policies/privacy-policy/',
    termsUrl: 'https://openai.com/policies/services-agreement/',
  },
  atlas: {
    id: 'atlas',
    name: 'Atlas Cloud',
    origin: 'https://api.atlascloud.ai',
    authType: 'bearer',
    credentialLabel: 'Atlas Cloud API key',
    documentationUrl: 'https://docs.atlascloud.ai/',
    privacyUrl: 'https://www.atlascloud.ai/privacy-policy',
    termsUrl: 'https://www.atlascloud.ai/terms-of-service',
  },
  byteplus: {
    id: 'byteplus',
    name: 'BytePlus ModelArk',
    origin: 'https://ark.ap-southeast.bytepluses.com',
    authType: 'bearer',
    credentialLabel: 'BytePlus ModelArk API key',
    documentationUrl: 'https://docs.byteplus.com/en/docs/ModelArk',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face Inference',
    origin: 'https://router.huggingface.co',
    authType: 'bearer',
    credentialLabel: 'Hugging Face access token',
    documentationUrl: 'https://huggingface.co/docs/inference-providers',
    privacyUrl: 'https://huggingface.co/privacy',
    termsUrl: 'https://huggingface.co/terms-of-service',
  },
  bfl: {
    id: 'bfl',
    name: 'Black Forest Labs',
    origin: 'https://api.bfl.ai',
    authType: 'api-key-header',
    credentialLabel: 'Black Forest Labs API key',
    headerName: 'x-key',
    documentationUrl: 'https://docs.bfl.ai/',
  },
  stability: {
    id: 'stability',
    name: 'Stability AI',
    origin: 'https://api.stability.ai',
    authType: 'bearer',
    credentialLabel: 'Stability AI API key',
    documentationUrl: 'https://platform.stability.ai/docs',
    privacyUrl: 'https://stability.ai/privacy-policy',
  },
  localOpen: {
    id: 'localOpen',
    name: 'Local / Open Models',
    origin: 'http://127.0.0.1:41736',
    authType: 'none',
    allowPlainHttpPrivateNetwork: true,
    documentationUrl: 'https://sloom.studio/docs.html',
  },
  android: {
    id: 'android',
    name: 'Android Accelerator',
    origin: 'http://127.0.0.1',
    authType: 'custom-built-in',
    credentialLabel: 'Paired Android token',
    allowPlainHttpPrivateNetwork: true,
    documentationUrl: 'https://sloom.studio/docs.html',
  },
  elevenlabs: {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    origin: 'https://api.elevenlabs.io',
    authType: 'api-key-header',
    credentialLabel: 'ElevenLabs API key',
    headerName: 'xi-api-key',
    documentationUrl: 'https://elevenlabs.io/docs/api-reference',
    privacyUrl: 'https://elevenlabs.io/privacy-policy',
    termsUrl: 'https://elevenlabs.io/terms-of-use',
  },
};

const ALL_MODEL_CONTRACTS = [
  ...TEXT_MODEL_CONTRACTS,
  ...IMAGE_MODEL_CONTRACTS,
  ...VIDEO_MODEL_CONTRACTS,
  ...AUDIO_MODEL_CONTRACTS,
] as readonly ProviderModelContract[];

export const BUNDLED_PROVIDER_PACKS: readonly ProviderPackV1[] = Object.values(PROVIDERS)
  .map(createBundledProviderPack)
  .filter((pack) => pack.cards.length > 0);

export const BUNDLED_ATLAS_PROVIDER_PACK = BUNDLED_PROVIDER_PACKS.find(
  (pack) => pack.packId === 'sloom.bundled.atlas',
) as ProviderPackV1;

export function getBundledProviderPack(packId: string): ProviderPackV1 | undefined {
  return BUNDLED_PROVIDER_PACKS.find((pack) => pack.packId === packId);
}

export function getBundledCardByLegacyModel(
  providerId: string,
  modelId: string,
): { pack: ProviderPackV1; card: FlowModelCardV1 } | undefined {
  const pack = BUNDLED_PROVIDER_PACKS.find((candidate) => candidate.packId === `sloom.bundled.${providerId}`);
  const card = pack?.cards.find((candidate) => candidate.modelId === modelId);
  return pack && card ? { pack, card } : undefined;
}

function createBundledProviderPack(provider: BundledProviderDefinition): ProviderPackV1 {
  const credentialSlots: CredentialSlotV1[] = provider.authType === 'none'
    ? []
    : [{
        id: 'default',
        label: provider.credentialLabel ?? `${provider.name} credential`,
        authType: provider.authType,
        approvedOrigin: provider.origin,
        headerName: provider.headerName,
        builtInEngineId: provider.id,
        required: true,
      }];
  const transport: TransportProfileV1 = {
    id: 'legacy-runtime',
    label: `${provider.name} registered runtime`,
    kind: 'built-in',
    approvedOrigin: provider.origin,
    credentialSlotId: credentialSlots[0]?.id,
    builtInEngineId: provider.id,
  };
  const cards = ALL_MODEL_CONTRACTS
    .filter((contract) => contract.providerId === provider.id)
    .map((contract) => contractToCard(contract, transport.id));
  return {
    schemaVersion: 1,
    packId: `sloom.bundled.${provider.id}`,
    version: '1.0.0',
    displayName: `${provider.name} bundled provider pack`,
    description: `Immutable recovery pack generated from Sloom's audited ${provider.name} model contracts.`,
    provider: {
      name: provider.name,
      documentationUrl: provider.documentationUrl,
      privacyUrl: provider.privacyUrl,
      termsUrl: provider.termsUrl,
    },
    approvedOrigins: [{
      origin: provider.origin,
      label: provider.name,
      allowPlainHttpPrivateNetwork: provider.allowPlainHttpPrivateNetwork,
    }],
    credentialSlots,
    discovery: [
      { id: 'sloom-manifest', kind: 'sloom-manifest', path: '/.well-known/sloom-provider.json', method: 'GET' },
      { id: 'known-profile', kind: 'known-profile' },
      { id: 'models', kind: 'model-list', path: '/v1/models', method: 'GET', credentialSlotId: credentialSlots[0]?.id, modelListPointer: '/data' },
    ],
    optionCatalogs: [],
    transports: [transport],
    cards,
    release: {
      minimumSloomVersion: PROVIDER_PACK_RELEASE_METADATA.minimumSloomVersion,
      sourceDocumentationUrls: provider.documentationUrl ? [provider.documentationUrl] : [],
      forumCategoryUrl: PROVIDER_PACK_RELEASE_METADATA.forumCategoryUrl,
      githubDiscussionsCategoryUrl: PROVIDER_PACK_RELEASE_METADATA.githubDiscussionsCategoryUrl,
    },
  };
}

function contractToCard(contract: ProviderModelContract, transportProfileId: string): FlowModelCardV1 {
  const operations = contract.operations.map((operation) =>
    createOperation(contract, operation, transportProfileId)
  );
  const operationIds = operations.map((operation) => operation.id);
  const fields = contract.parameters.map((parameter) =>
    parameterToField(parameter, contract.operations, operationIds)
  );
  const outputModality = primaryOutputModality(contract);
  const output: ModelOutputV1 = {
    id: `${outputModality}-output`,
    label: `${capitalize(outputModality)} output`,
    semanticRole: `${outputModality === 'json' ? 'json' : outputModality}-output` as ModelOutputSemanticRoleV1,
    resultType: outputModality,
    primary: true,
    cardinality: hasArrayOutput(contract) ? 'many' : 'one',
    operationIds,
  };
  for (const operation of operations) operation.outputIds = [output.id];
  const referenceMaximum = fields
    .filter((field) => field.semanticRole === 'reference-image')
    .reduce((maximum, field) => Math.max(maximum, field.constraints?.maxItems ?? 0), 0);
  const width = referenceMaximum > 12
    ? CARD_WIDTH_PRESETS.extraWide
    : referenceMaximum > 6
      ? CARD_WIDTH_PRESETS.wide
      : CARD_WIDTH_PRESETS.standard;
  const cardBase: Omit<FlowModelCardV1, 'layout'> = {
    schemaVersion: 1,
    id: cardId(contract.modelId),
    modelId: contract.modelId,
    displayName: contract.displayName,
    description: contract.recommendedUse,
    modalities: contract.outputModalities
      .filter((modality): modality is ModelModalityV1 => ['text', 'image', 'video', 'audio'].includes(modality)),
    fields,
    outputs: [output],
    operations,
    evidence: [...contract.evidence],
    confidence: contract.lifecycle === 'unverified'
      ? 'inferred'
      : contract.evidence.length > 0
        ? 'provider-verified'
        : 'sloom-recognized',
    status: 'ready-untested',
    tags: [contract.lifecycle, contract.availability, contract.apiFamily],
  };
  const layout = generateAutomaticCardLayout(cardBase, {
    width,
    fitTarget: '1080p',
    heightBudget: BUNDLED_CARD_HEIGHT_BUDGET,
    galleryColumns: referenceMaximum > 12 ? 4 : referenceMaximum > 6 ? 3 : 2,
  });
  return { ...cardBase, layout };
}

function createOperation(
  contract: ProviderModelContract,
  operation: ModelOperation,
  transportProfileId: string,
): ModelCardOperationV1 {
  const operationId = operation;
  const activeParameters = contract.parameters.filter((parameter) =>
    !parameter.conditions?.operations || parameter.conditions.operations.includes(operation)
  );
  const visibleFieldIds = activeParameters.map((parameter) => parameter.id);
  return {
    id: operationId,
    label: operation.split('-').map(capitalize).join(' '),
    transportProfileId,
    requiredFieldIds: activeParameters.filter((parameter) => parameter.required).map((parameter) => parameter.id),
    visibleFieldIds,
    inputPortFieldIds: activeParameters.filter((parameter) => isConnectableParameter(parameter)).map((parameter) => parameter.id),
    outputIds: [],
    endpointPath: contract.endpoint.startsWith('/') ? contract.endpoint : undefined,
    requestBindings: activeParameters.map((parameter) => ({
      fieldId: parameter.id,
      requestPath: parameter.apiName,
      omitWhenEmpty: !parameter.required,
      encoding: mediaEncoding(parameter),
    })),
    evidence: [...contract.evidence],
  };
}

function parameterToField(
  parameter: ModelParameterContract,
  operations: readonly ModelOperation[],
  operationIds: string[],
): ModelFieldV1 {
  const role = semanticRole(parameter);
  const activeOperations = [
    ...(parameter.conditions?.operations?.filter((operation) => operations.includes(operation))
      ?? operations),
  ];
  const valueType = fieldValueType(parameter, role);
  const cardinality = ['prompt', 'system-instruction', 'context', 'media-context', 'script'].includes(role)
    ? 'one'
    : parameter.type === 'array'
      ? 'many'
      : 'one';
  return {
    id: parameter.id,
    label: parameter.label,
    description: parameter.description,
    apiPath: parameter.apiName,
    semanticRole: role,
    valueType,
    cardinality,
    required: parameter.required,
    connectable: isConnectableRole(role),
    constraints: {
      min: parameter.min,
      max: parameter.max,
      step: parameter.step,
      minItems: parameter.minItems,
      maxItems: parameter.maxItems,
      visiblePortCount: cardinality === 'many' && parameter.maxItems ? parameter.maxItems : undefined,
    },
    encoding: mediaEncoding(parameter),
    options: parameter.options?.map((option) => ({ value: option.value, label: option.label })),
    defaultValue: parameter.defaultValue,
    operationIds: activeOperations.length ? activeOperations : operationIds,
    control: controlKind(parameter, role),
    advanced: role === 'advanced' || Boolean(parameter.conditions?.parameter),
  };
}

function semanticRole(parameter: ModelParameterContract): ModelFieldSemanticRoleV1 {
  const key = `${parameter.id} ${parameter.apiName} ${parameter.label}`.toLowerCase();
  if (/system/.test(key)) return 'system-instruction';
  if (/negative/.test(key)) return 'advanced';
  if (/mask/.test(key)) return 'mask';
  if (/start.*(frame|image)|first.*frame/.test(key)) return 'start-frame';
  if (/end.*(frame|image)|last.*frame/.test(key)) return 'end-frame';
  if (/reference|input_image_[2-9]|images/.test(key) && parameter.type === 'array') return 'reference-image';
  if (/source.*video|input.*video|video_uri/.test(key)) return 'source-video';
  if (/source.*audio|input.*audio|audio_uri/.test(key)) return 'source-audio';
  if (/source.*image|input_image|subject_image|^image$/.test(key)) return 'source-image';
  if (/control.*image/.test(key)) return 'control-image';
  if (/script|speech|text_to_speech/.test(key)) return 'script';
  if (/voice/.test(key)) return 'voice';
  if (/style/.test(key)) return 'style';
  if (/duration|seconds/.test(key)) return 'duration';
  if (/frame.*rate|fps/.test(key)) return 'frame-rate';
  if (/width/.test(key)) return 'width';
  if (/height/.test(key)) return 'height';
  if (/resolution|image_size|video_size/.test(key)) return 'resolution';
  if (/format|mime/.test(key)) return 'format';
  if (/seed/.test(key)) return 'seed';
  if (/quantity|count|number of|^n$|max_images/.test(key)) return 'quantity';
  if (/prompt|contents|^input$|^inputs$/.test(key)) return 'prompt';
  if (/context/.test(key)) return 'context';
  return 'advanced';
}

function fieldValueType(
  parameter: ModelParameterContract,
  role: ModelFieldSemanticRoleV1,
): FieldValueTypeV1 {
  if (['prompt', 'system-instruction', 'context', 'media-context', 'script'].includes(role)) return 'string';
  if (['source-image', 'mask', 'reference-image', 'control-image', 'start-frame', 'end-frame'].includes(role)) return 'image';
  if (['source-video', 'reference-video'].includes(role)) return 'video';
  if (role === 'source-audio') return 'audio';
  if (parameter.type === 'array' || parameter.type === 'object') return 'json';
  return parameter.type;
}

function controlKind(
  parameter: ModelParameterContract,
  role: ModelFieldSemanticRoleV1,
): CardControlKindV1 {
  if (role === 'prompt') return 'prompt';
  if (['source-image', 'mask', 'control-image', 'source-video', 'source-audio', 'start-frame', 'end-frame'].includes(role)) return 'media';
  if (['reference-image', 'reference-video'].includes(role)) return 'reference-gallery';
  if (parameter.type === 'boolean') return 'toggle';
  if (parameter.type === 'enum') return 'dropdown';
  if (['number', 'integer'].includes(parameter.type) && parameter.min !== undefined && parameter.max !== undefined) return 'slider';
  if (['number', 'integer'].includes(parameter.type)) return 'number';
  if (role === 'advanced') return 'advanced-value';
  return 'text';
}

function isConnectableParameter(parameter: ModelParameterContract): boolean {
  return isConnectableRole(semanticRole(parameter));
}

function isConnectableRole(role: ModelFieldSemanticRoleV1): boolean {
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

function mediaEncoding(parameter: ModelParameterContract) {
  const role = semanticRole(parameter);
  return isConnectableRole(role) && !['prompt', 'context', 'media-context', 'script'].includes(role)
    ? 'base64' as const
    : 'json' as const;
}

function primaryOutputModality(
  contract: ProviderModelContract,
): Extract<ModelModalityV1 | 'json', 'text' | 'image' | 'video' | 'audio' | 'json'> {
  const modality = contract.outputModalities.find((candidate) =>
    ['text', 'image', 'video', 'audio', 'json'].includes(candidate)
  );
  return (modality ?? 'json') as 'text' | 'image' | 'video' | 'audio' | 'json';
}

function hasArrayOutput(contract: ProviderModelContract): boolean {
  return contract.parameters.some((parameter) =>
    ['n', 'quantity', 'max_images', 'num_outputs'].includes(parameter.apiName)
  );
}

function cardId(modelId: string): string {
  return `model:${modelId}`.replace(/[^a-z0-9._:/-]/gi, '-');
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
